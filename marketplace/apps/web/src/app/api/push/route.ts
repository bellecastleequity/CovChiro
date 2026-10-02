import { NextResponse, type NextRequest } from "next/server";
import { push } from "@cm/services";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET: the public key browsers need to subscribe. POST: save this device. DELETE: forget it. */
export async function GET() {
  return NextResponse.json({ publicKey: await push.pushPublicKey() });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    await push.subscribe(s.user.id, await req.json(), req.headers.get("user-agent"));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "That device couldn't be registered." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: true });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await push.unsubscribe(s.user.id, endpoint);
  return NextResponse.json({ ok: true });
}
