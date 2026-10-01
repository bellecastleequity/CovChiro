import { NextResponse } from "next/server";
import { backups } from "@cm/services";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Download one encrypted database export (admins with two-factor only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.actor.role !== "PLATFORM_ADMIN" || !s.mfaVerified) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const f = await backups.backupFile(s.actor, (await params).id);
    return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Not found", { status: 404 });
  }
}
