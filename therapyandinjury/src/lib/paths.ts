// Every indexable public URL, in one place. Feeds sitemap.xml, llms.txt and the
// IndexNow submission script, so a page is never in one list but missing from another.
// Coming-soon locations are deliberately excluded (they're noindex).
import { indexableBranches, branchPath } from './site';
import { conditions } from './conditions';
import { posts } from './blog';

export type PublicPath = { path: string; priority: number; changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly'; lastmod?: Date };

export async function publicPaths(): Promise<PublicPath[]> {
  const blog = await posts();
  return [
    { path: '/', priority: 1.0, changefreq: 'weekly' },
    ...indexableBranches.flatMap((b): PublicPath[] => [
      { path: branchPath(b), priority: 0.9, changefreq: 'monthly' },
      { path: `${branchPath(b)}car-accident-chiropractor/`, priority: 0.9, changefreq: 'monthly' },
    ]),
    { path: '/auto-accident-injuries/', priority: 0.9, changefreq: 'monthly' },
    { path: '/what-to-do-after-a-car-accident/', priority: 0.8, changefreq: 'monthly' },
    { path: '/locations/', priority: 0.8, changefreq: 'monthly' },
    { path: '/services/', priority: 0.7, changefreq: 'monthly' },
    { path: '/conditions/', priority: 0.7, changefreq: 'monthly' },
    ...conditions.map((c): PublicPath => ({ path: `/conditions/${c.slug}/`, priority: 0.7, changefreq: 'monthly' })),
    { path: '/faq/', priority: 0.6, changefreq: 'monthly' },
    { path: '/about/', priority: 0.5, changefreq: 'monthly' },
    { path: '/contact/', priority: 0.5, changefreq: 'monthly' },
    { path: '/patients/', priority: 0.6, changefreq: 'monthly' },
    { path: '/blog/', priority: 0.6, changefreq: 'weekly', lastmod: blog[0]?.data.updated ?? blog[0]?.data.pubDate },
    ...blog.map((p): PublicPath => ({ path: `/blog/${p.id}/`, priority: 0.5, changefreq: 'yearly', lastmod: p.data.updated ?? p.data.pubDate })),
    { path: '/privacy/', priority: 0.2, changefreq: 'yearly' },
    { path: '/accessibility/', priority: 0.2, changefreq: 'yearly' },
  ];
}
