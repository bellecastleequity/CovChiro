import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@cm/config";
import { callline } from "@cm/services";

/**
 * Amazon Connect call menu → Lambda (deploy/aws/connect/menu-lambda.mjs) → here. The Lambda signs every
 * request: header x-cm-timestamp (unix seconds) and x-cm-signature = hex HMAC-SHA256 of
 * "<timestamp>.<raw body>" with CONNECT_WEBHOOK_SECRET. Requests older than 5 minutes are refused.
 * Body: { action: "lookup" | "text" | "callback", contactId, callerPhone, choice: "same" | "other", digits }.
 * Answer: { result: "done" | "retry" | "stay", say, lastFour?, canText? } (flat strings, for Connect).
 */
export async function POST(req: NextRequest) {
  const secret = env().CONNECT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await req.text();
  const ts = req.headers.get("x-cm-timestamp") ?? "";
  const sig = req.headers.get("x-cm-signature") ?? "";
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  const want = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const ok = /^[0-9a-f]{64}$/.test(sig) && Number.isFinite(age) && age < 300 && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const action = body.action === "text" || body.action === "callback" || body.action === "lookup" ? body.action : null;
  if (!action) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    const r = await callline.callMenu({
      action, contactId: String(body.contactId ?? ""), callerPhone: typeof body.callerPhone === "string" ? body.callerPhone : null,
      choice: body.choice === "other" ? "other" : "same", digits: typeof body.digits === "string" ? body.digits : null,
    });
    return NextResponse.json({ result: r.result, say: r.say, lastFour: r.lastFour ?? "", canText: r.canText === false ? "no" : "yes" });
  } catch (e) {
    return NextResponse.json({ result: "stay", say: "Sorry, something went wrong on our side. Let's continue on the call.", error: String((e as Error).message ?? e).slice(0, 200) });
  }
}
