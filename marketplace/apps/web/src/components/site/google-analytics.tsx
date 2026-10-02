"use client";

import { Suspense, useEffect } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";

declare global { interface Window { gtag?: (...a: unknown[]) => void } }

/** Only these query parameters reach Google; tracked-link tokens, invite codes etc. never do. */
const KEEP = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "role"];

let lastSent = "";

function PageViews({ id }: { id: string }) {
  const path = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams();
    for (const k of KEEP) { const v = search.get(k); if (v) q.set(k, v); }
    const location = `${window.location.origin}${path}${q.size ? `?${q}` : ""}`;
    if (location === lastSent) return;
    lastSent = location;
    const send = () => window.gtag?.("event", "page_view", { send_to: id, page_location: location, page_path: path, page_title: document.title });
    if (window.gtag) send();
    else { const t = setTimeout(send, 1500); return () => clearTimeout(t); }
  }, [id, path, search]);
  return null;
}

/**
 * Google Analytics 4 on the public site and sign-up only (never inside accounts or on
 * token links like password resets). Automatic page views are off; PageViews sends a
 * cleaned address instead. The ID is validated (G-XXXXXXXXXX) before it's used.
 */
export function GoogleAnalytics({ id }: { id: string }) {
  if (!/^G-[A-Z0-9]{4,15}$/.test(id)) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments);};gtag('js',new Date());gtag('config','${id}',{send_page_view:false});`}
      </Script>
      <Suspense fallback={null}><PageViews id={id} /></Suspense>
    </>
  );
}
