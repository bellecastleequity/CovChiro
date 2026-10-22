import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@cm/db";
import { storageProvider, thumbKey } from "@cm/integrations";
import { getSession } from "@/lib/session";

/**
 * Admin → Providers → "Shrink photos": headshots and clinic logos uploaded before photos were shrunk
 * in the browser (owner, Oct 2026: >1 minute to load). GET lists the ones without a small copy; POST
 * takes the shrunk photo + thumbnail the admin's browser made and writes them over the same key.
 */
async function admin() {
  const s = await getSession();
  return !!s && s.actor.role === "PLATFORM_ADMIN" && s.mfaVerified;
}

async function photoKeys() {
  const [providers, clinics] = await Promise.all([
    prisma.provider.findMany({ where: { photoUrl: { startsWith: "photos/" } }, select: { photoUrl: true } }),
    prisma.clinicOrg.findMany({ where: { logoUrl: { startsWith: "photos/" } }, select: { logoUrl: true } }),
  ]);
  return [...new Set([...providers.map((p) => p.photoUrl!), ...clinics.map((c) => c.logoUrl!)])];
}

export async function GET() {
  if (!(await admin())) return new NextResponse("Not found", { status: 404 });
  const st = storageProvider();
  const keys = await photoKeys();
  const missing: string[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const part = keys.slice(i, i + 20);
    const has = await Promise.all(part.map((k) => st.exists(thumbKey(k))));
    part.forEach((k, j) => { if (!has[j]) missing.push(k); });
  }
  return NextResponse.json({ total: keys.length, missing });
}

const TYPES = ["image/jpeg", "image/png", "image/webp"];
export async function POST(req: NextRequest) {
  if (!(await admin())) return new NextResponse("Not found", { status: 404 });
  const fd = await req.formData();
  const key = String(fd.get("key") ?? "");
  const photo = fd.get("photo"), thumb = fd.get("thumb");
  if (!(await photoKeys()).includes(key)) return NextResponse.json({ error: "Not a photo on file." }, { status: 400 });
  if (!(photo instanceof File) || !(thumb instanceof File) || !TYPES.includes(photo.type) || !TYPES.includes(thumb.type) || photo.size > 2 * 1024 * 1024 || thumb.size > 512 * 1024) {
    return NextResponse.json({ error: "Expected a shrunk photo and thumbnail." }, { status: 400 });
  }
  const st = storageProvider();
  // Only replace the photo when the shrunk one is smaller (a photo that was already small stays as is).
  const current = await st.read(key);
  if (current && photo.size < current.data.length) await st.putAt(key, Buffer.from(await photo.arrayBuffer()), photo.type);
  await st.putAt(thumbKey(key), Buffer.from(await thumb.arrayBuffer()), thumb.type);
  return NextResponse.json({ ok: true, before: current?.data.length ?? 0, after: Math.min(photo.size, current?.data.length ?? photo.size) });
}
