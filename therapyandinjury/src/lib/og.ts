// Build-time Open Graph images (1200x630 PNG) in brand colors, one per branch plus a
// brand default. Satori lays out the card and turns text into paths; resvg rasterizes.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const font = (w: number) => readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
const fonts = [
  { name: 'Inter', data: font(600), weight: 600 as const, style: 'normal' as const },
  { name: 'Inter', data: font(700), weight: 700 as const, style: 'normal' as const },
  { name: 'Inter', data: font(800), weight: 800 as const, style: 'normal' as const },
];
const markSvg = readFileSync(join(process.cwd(), 'public/brand/mark.svg'), 'utf8') // build runs from the project root;
const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg).toString('base64')}`;

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

export async function ogPng(opts: { name: string; line: string; badge?: string }) {
  const tree = h(
    'div',
    { width: 1200, height: 630, display: 'flex', background: '#FFFFFF', fontFamily: 'Inter', position: 'relative' },
    [
      // soft brand ring echo
      h('div', {
        position: 'absolute', right: -170, top: -120, width: 760, height: 760, borderRadius: 760,
        border: '110px solid #F4F6F8', display: 'flex',
      }),
      h('div', { position: 'absolute', left: 0, top: 0, bottom: 0, width: 18, background: '#19CCBE', display: 'flex' }),
      // Absolutely positioned so it paints above the decorative ring.
      h('div', { position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 80px 0 96px', width: 900 }, [
        h('img', { width: 120, height: 120, marginBottom: 40 }, undefined, { src: mark, width: 120, height: 120 }),
        h('div', { fontSize: opts.name.length > 22 ? 62 : 72, fontWeight: 800, color: '#0B2D5B', letterSpacing: -2, lineHeight: 1.05 }, opts.name),
        h('div', { fontSize: 24, fontWeight: 600, color: '#57667A', letterSpacing: 4, textTransform: 'uppercase', marginTop: 22 },
          'Chiropractic Injury & Wellness Care'),
        h('div', { width: 90, height: 6, background: '#19CCBE', borderRadius: 3, marginTop: 34, marginBottom: 30, display: 'flex' }),
        h('div', { fontSize: 30, fontWeight: 600, color: '#0B2D5B', lineHeight: 1.3 }, opts.line),
      ]),
      opts.badge
        ? h('div', {
            position: 'absolute', right: 70, bottom: 64, display: 'flex', padding: '14px 28px', borderRadius: 999,
            background: '#0B2D5B', color: '#FFFFFF', fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
          }, opts.badge)
        : h('div', { display: 'flex' }),
    ],
  );
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
