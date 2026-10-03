import { env, isSandbox } from "@cm/config";

/**
 * IndexNow: tells Bing (which also feeds ChatGPT and Copilot search), Yandex and
 * others that pages are new or changed, so they're crawled in minutes instead of
 * weeks. Google doesn't use it (it reads the sitemap from Search Console).
 * Outside production nothing is sent; submissions are kept in `indexNowSent`.
 */
export const indexNowSent: { host: string; urls: string[]; at: Date }[] = [];

export async function submitIndexNow(i: { host: string; key: string; keyLocation: string; urls: string[] }): Promise<{ ok: boolean; status: number | null; error?: string }> {
  if (!i.urls.length) return { ok: true, status: null };
  if (env().NODE_ENV !== "production" || isSandbox()) {
    indexNowSent.push({ host: i.host, urls: i.urls, at: new Date() });
    return { ok: true, status: 200 };
  }
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: i.host, key: i.key, keyLocation: i.keyLocation, urlList: i.urls.slice(0, 10_000) }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: (await r.text().catch(() => "")).slice(0, 200) };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message };
  }
}
