/**
 * Downloads a federal exclusion list (HHS-OIG LEIE UPDATED.csv, about 15 MB). Swappable under
 * test; with no fetcher set, the real download runs only outside tests.
 */
export type ExclusionListFetcher = (url: string) => Promise<string>;

let fetcher: ExclusionListFetcher | null = null;

export function exclusionListFetcher(): ExclusionListFetcher {
  return (
    fetcher ??
    (async (url: string) => {
      if (process.env.NODE_ENV === "test") throw new Error("Exclusion list downloads are off under test.");
      const r = await fetch(url, { headers: { "user-agent": "CoverageOnCall exclusion check" }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer()).toString("latin1");
    })
  );
}
export function setExclusionListFetcher(f: ExclusionListFetcher | null) {
  fetcher = f;
}
