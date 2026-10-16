import type { APIRoute, GetStaticPaths } from 'astro';
import { branches, branchName, oneLineAddress, isOpen } from '../../lib/site';
import { ogPng } from '../../lib/og';

export const getStaticPaths: GetStaticPaths = () => [
  { params: { slug: 'default' }, props: { name: 'Therapy & Injury', line: 'Chiropractic care for auto accident injuries, neck and back pain across Florida.' } },
  ...branches.map((b) => ({
    params: { slug: b.slug },
    props: {
      name: branchName(b),
      line: isOpen(b) && b.address ? oneLineAddress(b) : `Coming soon to ${b.city}, Florida`,
      badge: isOpen(b) ? undefined : 'Coming soon',
    },
  })),
];

export const GET: APIRoute = async ({ props }) => {
  const png = await ogPng(props as { name: string; line: string; badge?: string });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
