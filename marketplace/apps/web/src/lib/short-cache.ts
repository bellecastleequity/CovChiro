import "server-only";

/**
 * A few-seconds cache for the menu badges and banners every page's layout loads (counts, setup
 * status, health). Each page click otherwise repeats a dozen small database round trips. Any form
 * action clears it (lib/action.ts), so what you just changed shows on the next page.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const TTL_MS = 15_000;

export function shortCached<T>(key: string, fn: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { at: Date.now(), value });
  value.catch(() => store.delete(key));
  if (store.size > 500) store.delete(store.keys().next().value!);
  return value;
}

export function clearShortCache() {
  store.clear();
}
