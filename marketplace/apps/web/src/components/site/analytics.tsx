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
