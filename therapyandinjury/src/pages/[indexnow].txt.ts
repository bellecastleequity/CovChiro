import type { APIRoute } from 'astro';
import { site } from '../lib/site';

/** IndexNow key file at /<key>.txt (proves this site owns its IndexNow submissions). */
export const GET: APIRoute = ({ params }) => {
  const key = site.seo.indexNowKey;
  if (!key || params.indexnow !== key) return new Response(null, { status: 404 });
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
