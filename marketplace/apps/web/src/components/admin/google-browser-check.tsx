"use client";

import { useState } from "react";
import { loadPlaces } from "@/components/ui/address-input";

/**
 * Tests GOOGLE_MAPS_BROWSER_KEY from this browser, on this website — the
 * only place it can be tested, since the key is locked to the site's address.
 */
export function GoogleBrowserCheck({ browserKey }: { browserKey: string | null }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setState(null);
    const origin = window.location.origin;
    if (!browserKey) {
      setState({ ok: false, text: "GOOGLE_MAPS_BROWSER_KEY isn't set. Add it in cPanel → Setup Node.js App → Environment variables, then restart. Address fields still accept typed addresses without it." });
      return setBusy(false);
    }
    let rejected = false;
    const onFail = () => (rejected = true);
    window.addEventListener("cm-maps-auth-failure", onFail);
    try {
      const p = await loadPlaces(browserKey);
      const { suggestions } = await p.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: "1600 Pennsylvania Ave", includedRegionCodes: ["us"] });
      await new Promise((r) => setTimeout(r, 300));
      if (rejected) throw new Error("Google rejected the key for this website");
      setState({ ok: true, text: `Browser key works on ${origin} — ${suggestions.length} suggestions returned.` });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const hint = /RefererNotAllowed|referer|rejected the key for this website/i.test(msg)
        ? `Add ${origin}/* to the key's Websites list (and the www / non-www version you use).`
        : /ApiNotActivated|not been used|disabled|PERMISSION_DENIED|ApiTargetBlocked|not authorized/i.test(msg)
          ? "Enable Maps JavaScript API and Places API (New) — the one marked (New) — and tick both in the key's API restrictions."
          : /Billing/i.test(msg)
            ? "Turn on billing for the Google Cloud project."
            : /InvalidKey/i.test(msg)
              ? "The key isn't valid — re-copy it into GOOGLE_MAPS_BROWSER_KEY and restart."
              : "Open your browser's console (F12 → Console) for Google's message.";
      setState({ ok: false, text: `✗ ${msg} — Fix: ${hint}` });
    } finally {
      window.removeEventListener("cm-maps-auth-failure", onFail);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <button type="button" onClick={run} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        {busy ? "Testing…" : "Test address suggestions (browser key)"}
      </button>
      {state ? <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.text}</p> : null}
    </div>
  );
}
