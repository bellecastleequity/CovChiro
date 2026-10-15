import type { APIRoute } from 'astro';
import { site } from '../lib/site';

// Same policy as CoverageOnCall: everyone may crawl public pages, and AI search / answer
// engines are named explicitly so they can cite us. Only the form endpoint is off limits.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'Googlebot'];

export const GET: APIRoute = () => {
  const block = (ua: string) => `User-agent: ${ua}\nAllow: /\nDisallow: /api/\n`;
  const body = [block('*'), ...AI_BOTS.map(block), `Sitemap: ${site.domain}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
