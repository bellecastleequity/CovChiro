import { NextResponse, type NextRequest } from "next/server";
import { storageProvider } from "@cm/integrations";
import { getSession } from "@/lib/session";

/**
 * Authorised access to private documents. Admins see everything; providers
 * see their own documents; any signed-in user can see provider photos.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const s = await getSession();
  if (!s) return new NextResponse("Unauthorized", { status: 401 });
  const isAdmin = s.actor.role === "PLATFORM_ADMIN" && s.mfaVerified;
  const own = s.actor.providerId && key.startsWith(`providers/${s.actor.providerId}/`);
  const photo = key.startsWith("photos/");
  if (!isAdmin && !own && !photo) return new NextResponse("Not found", { status: 404 });
  const st = storageProvider();
  const signed = await st.signedUrl(key, 10);
  if (signed) return NextResponse.redirect(signed);
  const f = await st.read(key);
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.contentType, "Cache-Control": "private, max-age=300", "Content-Disposition": "inline" } });
}
