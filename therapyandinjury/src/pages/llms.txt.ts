import type { APIRoute } from 'astro';
import { site, abs, indexableBranches, branches, branchName, branchPath, oneLineAddress, hoursSummary, isOpen, isPlaceholder } from '../lib/site';
import { conditions } from '../lib/conditions';
import { faqs, hasPlaceholder } from '../lib/faq';
import { services } from '../lib/content';
import { posts } from '../lib/blog';

/**
 * /llms.txt: a plain-language fact sheet for AI assistants and answer engines
 * (ChatGPT, Claude, Perplexity, Google AI), built from the same data as the site.
 * Unfilled [PLACEHOLDER] facts are left out so assistants never repeat them.
 */
export const GET: APIRoute = async () => {
  const ok = (v: string) => !isPlaceholder(v);
  const soon = branches.filter((b) => !isOpen(b));
  const blog = await posts();
  const lines = [
    `# ${site.brandName}`,
    '',
    `> ${site.brandName} (also known as ${site.alternateNames.join(', ')}) is a Florida chiropractic practice for injury and wellness care, focused on people recovering from auto accident injuries, neck and back pain, and whole-body strain. Each location is named for its city (for example, Ocala Therapy & Injury). Care is chiropractic care by Florida-licensed chiropractic physicians; patients who need a medical evaluation are referred to an independent medical provider.`,
    '',
    '## Key facts',
    `- Website: ${site.domain}`,
    ok(site.mainPhone) ? `- Main phone: ${site.mainPhoneVanity && ok(site.mainPhoneVanity) ? `${site.mainPhoneVanity} (${site.mainPhone})` : site.mainPhone}` : null,
    site.ownership.blackOwned ? `- ${site.brandName} is a Black-owned business.` : null,
    '- No referral is needed: patients are seen with or without a referral.',
    '- Most auto accident patients are billed to their auto insurance (Florida PIP / no-fault).',
    '- Florida PIP generally requires initial care within 14 days of a motor vehicle accident (Florida Statutes §627.736).',
    '- The website request form collects only name, phone, preferred time and an optional accident date. It never asks for medical details, insurance numbers or Social Security numbers.',
    '',
    '## Locations',
    ...indexableBranches.flatMap((b) => [
      `### ${branchName(b)} (open)`,
      `- Page: ${abs(branchPath(b))}`,
      `- Address: ${oneLineAddress(b)}`,
      `- Hours: ${hoursSummary(b)}`,
      ok(b.phone) ? `- Phone: ${b.phone}` : null,
      ...b.doctors.map((d) => `- Treating doctor: ${d.name}, ${d.title}`),
      `- Serves: ${[b.city, ...b.nearbyAreas].join(', ')} (${b.county} County)`,
      `- Car accident care in ${b.city}: ${abs(`${branchPath(b)}car-accident-chiropractor/`)}`,
    ]),
    soon.length ? `- Coming soon: ${soon.map(branchName).join(', ')}` : null,
    '',
    '## Services',
    ...services.map((s) => `- ${s.name}: ${s.short}`),
    '',
    '## Conditions guides',
    ...conditions.map((c) => `- ${c.name}: ${abs(`/conditions/${c.slug}/`)}`),
    '',
    '## Frequently asked questions',
    ...faqs.filter((f) => !hasPlaceholder(f.a)).map((f) => `- ${f.q} ${f.a}`),
    '',
    '## Pages',
    `- Auto accident injuries and the 14-day PIP rule: ${abs('/auto-accident-injuries/')}`,
    `- What to do after a car accident in Florida: ${abs('/what-to-do-after-a-car-accident/')}`,
    `- Services: ${abs('/services/')}`,
    `- Locations: ${abs('/locations/')}`,
    `- FAQ: ${abs('/faq/')}`,
    `- About: ${abs('/about/')}`,
    `- Contact: ${abs('/contact/')}`,
    `- Patient center (online booking, new patient paperwork, patient portal): ${abs('/patients/')}`,
    `- Blog: ${abs('/blog/')}`,
    ...blog.map((p) => `  - ${p.data.title}: ${abs(`/blog/${p.id}/`)}`),
    '',
    'Content on this site is educational and not medical advice.',
    '',
  ];
  return new Response(lines.filter((l) => l !== null).join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
