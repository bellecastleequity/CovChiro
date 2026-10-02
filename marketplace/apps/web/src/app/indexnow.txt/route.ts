import { seo } from "@cm/services";

/** IndexNow key file (the key proves this site owns its submissions). */
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(await seo.indexNowKey(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
