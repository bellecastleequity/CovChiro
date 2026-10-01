"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

/** First-party page-view beacon. No third-party scripts, no IP stored. */
function Beacon() {
  const path = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (path.startsWith("/admin")) return;
    const body = JSON.stringify({
      type: "PAGE_VIEW",
      path,
      referrer: document.referrer || null,
      utm: { source: search.get("utm_source") ?? undefined, medium: search.get("utm_medium") ?? undefined, campaign: search.get("utm_campaign") ?? undefined },
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    else fetch("/api/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    const c = search.get("c");
    if (c && /^[a-f0-9]{40}$/.test(c)) trackProspect(c, "site_visit");
  }, [path, search]);
  return null;
}

export function Analytics() {
  return (
    <Suspense fallback={null}>
      <Beacon />
    </Suspense>
  );
}

export function trackClick(label: string) {
  const body = JSON.stringify({ type: "CTA_CLICK", path: location.pathname, props: { label } });
  navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }));
}

/** Growth lead-scoring signal for a visitor who arrived from one of our emails (?c=<token>). */
export function trackProspect(c: string, signal: "site_visit" | "calculator_used" | "pricing_viewed" | "signup_started", days?: number) {
  fetch("/api/track", { method: "POST", body: JSON.stringify({ type: "PROSPECT", c, signal, days }), headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
}
