import { NextResponse, type NextRequest } from "next/server";
import { isSandbox } from "@cm/config";
import { sandbox } from "@cm/services";
import { getSession } from "@/lib/session";

/** Test site: browser errors from any page (see components/site/sandbox-reporter.tsx). */
const recent: number[] = [];
export async function POST(req: NextRequest) {
  if (!isSandbox()) return new NextResponse("Not found", { status: 404 });
  // At most 30 a minute per app process: a page stuck in an error loop can't flood the log.
  const now = Date.now();
  while (recent.length && recent[0] < now - 60_000) recent.shift();
  if (recent.length >= 30) return NextResponse.json({ ok: false }, { status: 429 });
  recent.push(now);
  const b = (await req.json().catch(() => null)) as { message?: string; stack?: string; path?: string } | null;
  if (!b?.message) return NextResponse.json({ ok: false }, { status: 400 });
  const s = await getSession().catch(() => null);
  await sandbox.recordError({ source: "browser", message: String(b.message).slice(0, 500), detail: b.stack ? String(b.stack).slice(0, 4000) : null, path: b.path ? String(b.path).slice(0, 300) : null, userId: s?.user.id ?? null });
  return NextResponse.json({ ok: true });
}
