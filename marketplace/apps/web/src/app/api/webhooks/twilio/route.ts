import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@cm/config";
import { dispatch } from "@cm/services";

/**
 * Inbound SMS replies (YES 4821 / NO 4821 / STOP / HELP). The Twilio
 * signature is verified (HMAC-SHA1 of URL + sorted params) before anything
 * happens. Replies are returned as TwiML.
 */
function validSignature(url: string, params: Record<string, string>, signature: string | null, token: string) {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const twiml = (msg: string) =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`, { headers: { "Content-Type": "text/xml" } });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const e = env();
  if (e.TWILIO_AUTH_TOKEN) {
    const url = `${e.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/twilio`;
    if (!validSignature(url, params, req.headers.get("x-twilio-signature"), e.TWILIO_AUTH_TOKEN)) return new NextResponse("invalid signature", { status: 403 });
  } else if (e.NODE_ENV === "production") {
    return new NextResponse("not configured", { status: 503 });
  }
  const reply = await dispatch.handleInboundSms(params.From ?? "", params.Body ?? "");
  return twiml(reply);
}
