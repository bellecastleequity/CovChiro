import type { APIRoute } from 'astro';
import { site } from '../lib/site';

/** IndexNow key file at /<key>.txt (proves this site owns its IndexNow submissions). */
export function getStaticPaths() {
  const key = site.seo.indexNowKey;
  return key ? [{ params: { indexnow: key } }] : [];
}
export const GET: APIRoute = () => new Response(site.seo.indexNowKey, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
