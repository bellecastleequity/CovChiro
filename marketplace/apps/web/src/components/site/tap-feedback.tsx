"use client";

import { useEffect } from "react";

/**
 * A very short buzz when a finger taps a link or button, so a tap that did something is felt.
 * Android browsers only (iPhones don't let websites vibrate); off for reduced motion.
 */
export function TapFeedback() {
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || reduce?.matches) return;
      const el = (e.target as Element | null)?.closest?.("a[href], button:not(:disabled), [role=button], summary, label:has(input)");
      if (!el) return;
      try { navigator.vibrate(8); } catch { /* not allowed */ }
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
