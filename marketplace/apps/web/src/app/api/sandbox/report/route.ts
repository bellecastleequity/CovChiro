import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { isSandbox } from "@cm/config";
import { DomainError } from "@cm/core";
import { auth, sandbox } from "@cm/services";
import { getSession } from "@/lib/session";

/** Test site: "Report a problem" from the amber bar. */
export async function POST(req: NextRequest) {
  if (!isSandbox()) return new NextResponse("Not found", { status: 404 });
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Sign in first, then report the problem." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { note?: string; path?: string; client?: { userAgent?: string; viewport?: string; browserErrors?: string[] } } | null;
  // Using Act as: credit the admin behind the demo login.
  const back = (await cookies()).get("cm_sandbox_admin")?.value;
  const admin = back ? await auth.sessionFromToken(back).catch(() => null) : null;
  try {
    await sandbox.createReport({ userId: s.user.id, name: s.user.name, email: s.user.email, adminUserId: admin?.user.role === "PLATFORM_ADMIN" ? admin.user.id : null }, { note: String(b?.note ?? ""), path: b?.path ?? null, client: b?.client ?? null });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
