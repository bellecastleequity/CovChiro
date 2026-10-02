/**
 * Side-menu order. Default: the area's pinned items first (Home, then Post shift / Find shifts),
 * then everything else A–Z by label. A person's saved order wins; items added to the menu later
 * (not in their saved list) slot in after it in default order, and removed ones are ignored.
 */
export const NAV_PINNED: Record<string, string[]> = {
  "/provider": ["/provider", "/provider/shifts"],
  "/clinic": ["/clinic", "/clinic/shifts/new"],
  "/admin": ["/admin"],
};

export function defaultNavOrder<T extends { href: string; label: string }>(items: T[], root: string): T[] {
  const pinned = NAV_PINNED[root] ?? [root];
  const head = pinned.map((h) => items.find((i) => i.href === h)).filter((i): i is T => !!i);
  const rest = items.filter((i) => !pinned.includes(i.href)).sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return [...head, ...rest];
}

export function orderNav<T extends { href: string; label: string }>(items: T[], root: string, saved: string[] | null | undefined): T[] {
  const def = defaultNavOrder(items, root);
  if (!saved?.length) return def;
  const byHref = new Map(items.map((i) => [i.href, i]));
  const picked = [...new Set(saved)].map((h) => byHref.get(h)).filter((i): i is T => !!i);
  const seen = new Set(picked.map((i) => i.href));
  return [...picked, ...def.filter((i) => !seen.has(i.href))];
}

/** Clean a submitted order: hrefs inside the area, no duplicates, bounded. */
export function cleanNavOrder(root: string, hrefs: unknown): string[] {
  if (!Array.isArray(hrefs)) return [];
  const out: string[] = [];
  for (const h of hrefs) {
    if (typeof h !== "string" || h.length > 120 || !(h === root || h.startsWith(`${root}/`)) || out.includes(h)) continue;
    out.push(h);
    if (out.length >= 80) break;
  }
  return out;
}
