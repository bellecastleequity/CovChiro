// Every indexable public URL, in one place. Feeds sitemap.xml, llms.txt and the
// IndexNow submission script, so a page is never in one list but missing from another.
// Coming-soon locations are deliberately excluded (they're noindex).
import { indexableBranches, branchPath, siteUpdatedAt, videoFacts, abs } from './site';

// The landing pages' own commercials (files in public/media; text matches src/components/LangLanding.astro).
const langVideo = (l: 'es' | 'ht'): ReturnType<typeof videoFacts> => {
  const v = l === 'es'
    ? { slug: 'no-se-haga-el-fuerte-30', title: 'No se haga el fuerte', description: 'Comercial de Therapy & Injury: después de un choque, hágase un chequeo. El PIP de Florida generalmente requiere atención dentro de los 14 días.' }
    : { slug: 'pa-neglije-ko-w-30', title: 'Pa neglije kò w', description: 'Piblisite Therapy & Injury: apre yon aksidan, fè tcheke kò w. Lwa PIP Florid la jeneralman mande swen anndan 14 jou.' };
  return { title: v.title, description: v.description, transcript: '', poster: abs(`/media/${v.slug}-poster.jpg`), date: '2026-10-18', contentUrl: abs(`/media/${v.slug}.mp4`), embedUrl: '', seconds: 30 };
};
import { conditions } from './conditions';
import { posts } from './blog';

export type PublicPath = { path: string; priority: number; changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly'; lastmod?: Date; video?: ReturnType<typeof videoFacts> };

export async function publicPaths(): Promise<PublicPath[]> {
  const blog = await posts();
  const updated = siteUpdatedAt();
  const list: PublicPath[] = [
    { path: '/', priority: 1.0, changefreq: 'weekly', video: videoFacts() },
    ...indexableBranches.flatMap((b): PublicPath[] => [
      { path: branchPath(b), priority: 0.9, changefreq: 'monthly', video: videoFacts(b) },
      { path: `${branchPath(b)}car-accident-chiropractor/`, priority: 0.9, changefreq: 'monthly' },
    ]),
    // Spanish and Haitian Creole landing pages (their commercials are listed with them).
    { path: '/es/', priority: 0.9, changefreq: 'monthly', video: langVideo('es') },
    { path: '/ht/', priority: 0.9, changefreq: 'monthly', video: langVideo('ht') },
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
    { path: '/notice-of-privacy-practices/', priority: 0.2, changefreq: 'yearly' },
    { path: '/accessibility/', priority: 0.2, changefreq: 'yearly' },
  ];
  // Pages built from the site data change when a release ships or the editor saves; blog posts keep their own dates.
  return list.map((p) => ({ ...p, lastmod: p.lastmod ?? updated }));
}
