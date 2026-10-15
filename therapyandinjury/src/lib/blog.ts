import { getCollection } from 'astro:content';

/** Published posts, newest first. */
export async function posts() {
  return (await getCollection('blog', (p) => !p.data.draft)).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
