import { NextResponse, type NextRequest } from "next/server";
import { storageProvider, thumbKey } from "@cm/integrations";
import { canViewLocationPhoto, stay } from "@cm/services";
import { getSession } from "@/lib/session";

/**
 * Authorised access to private documents. Admins see everything; providers
 * see their own documents; any signed-in user can see provider photos;
 * clinic location photos are for that clinic and providers booked there.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const s = await getSession();
  if (!s) return new NextResponse("Unauthorized", { status: 401 });
  const isAdmin = s.actor.role === "PLATFORM_ADMIN" && s.mfaVerified;
  const own = s.actor.providerId && key.startsWith(`providers/${s.actor.providerId}/`);
  const photo = key.startsWith("photos/");
  const clinicDoc = !!s.actor.clinicOrgId && key.startsWith(`clinics/${s.actor.clinicOrgId}/`);
  const locationPhoto = key.startsWith("locations/") && (await canViewLocationPhoto(s.actor, key));
  // Clinic-booked stay confirmation: also the provider it was saved for.
  const stayFile = !clinicDoc && !!s.actor.providerId && key.startsWith("clinics/") && key.includes("/stays/") && (await stay.canViewStayFile(s.actor, key));
  if (!isAdmin && !own && !clinicDoc && !photo && !locationPhoto && !stayFile) return new NextResponse("Not found", { status: 404 });
  const st = storageProvider();
  // Photos: ?s=thumb serves the small copy made at upload (or by Admin → Providers → Shrink photos),
  // and the browser keeps them for a day (keys are random, so a new photo is a new address).
  const picture = photo || (key.startsWith("locations/") && locationPhoto);
  const wantThumb = picture && req.nextUrl.searchParams.get("s") === "thumb";
  const target = wantThumb && (await st.exists(thumbKey(key))) ? thumbKey(key) : key;
  const cache = picture ? "private, max-age=86400" : "private, max-age=300";
  const signed = await st.signedUrl(target, picture ? 60 * 24 : 10);
  if (signed) return NextResponse.redirect(signed, { headers: { "Cache-Control": cache } });
  const f = await st.read(target);
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.contentType, "Cache-Control": cache, "Content-Disposition": "inline" } });
}
