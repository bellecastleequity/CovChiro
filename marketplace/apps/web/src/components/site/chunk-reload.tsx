"use client";

import { useEffect } from "react";

const CHUNK_ERROR = /ChunkLoadError|Failed to load chunk|Loading chunk [\w-]+ failed|module factory is not available|Failed to fetch dynamically imported module/i;
const KEY = "cm_chunk_reload";

/**
 * After an update, a page opened before it asks for code files that no longer exist (each release
 * has new file names). Reload once to pick up the new version; never loop (once per 30 seconds).
 */
export function ChunkReload() {
  useEffect(() => {
    const onError = (reason: unknown) => {
      const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String((reason as { message?: string })?.message ?? reason);
      if (!CHUNK_ERROR.test(text)) return;
      try {
        const last = Number(sessionStorage.getItem(KEY) ?? 0);
        if (Date.now() - last < 30_000) return;
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        return;
      }
      window.location.reload();
    };
    const err = (e: ErrorEvent) => onError(e.error ?? e.message);
    const rej = (e: PromiseRejectionEvent) => onError(e.reason);
    window.addEventListener("error", err);
    window.addEventListener("unhandledrejection", rej);
    return () => {
      window.removeEventListener("error", err);
      window.removeEventListener("unhandledrejection", rej);
    };
  }, []);
  return null;
}
