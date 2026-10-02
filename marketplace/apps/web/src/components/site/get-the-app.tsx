"use client";

import { useEffect, useState } from "react";
import { BatteryFull, Check, Share, Signal, Smartphone, Wifi } from "lucide-react";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Apple-style and Android-style marks, drawn by us (not the store badges: the app installs from the browser). */
const AppleMark = () => (
  <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="currentColor">
    <path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.6zM14.1 5.5c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z" />
  </svg>
);
const AndroidMark = () => (
  <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="currentColor">
    <path d="M17.6 9.5l1.7-2.9a.4.4 0 0 0-.7-.4l-1.7 3A10.4 10.4 0 0 0 12 8.2c-1.8 0-3.4.4-4.9 1L5.4 6.2a.4.4 0 0 0-.7.4l1.7 2.9A9.3 9.3 0 0 0 2 17h20a9.3 9.3 0 0 0-4.4-7.5zM7.5 14.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm9 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
  </svg>
);

function StoreButton({ mark, small, big, onClick, active }: { mark: React.ReactNode; small: string; big: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-w-44 items-center gap-3 rounded-xl px-4 py-2.5 text-left text-white shadow-sm transition ${active ? "bg-brand-700 ring-2 ring-accent-400" : "bg-slate-900 hover:bg-slate-800"}`}>
      {mark}
      <span>
        <span className="block text-[10px] uppercase tracking-wide text-slate-300">{small}</span>
        <span className="block text-base font-semibold leading-tight">{big}</span>
      </span>
    </button>
  );
}

/** A phone showing the app with a live-looking offer notification. Pure CSS/SVG. */
export function PhoneMockup() {
  return (
    <div className="relative mx-auto w-56 sm:w-64" aria-hidden>
      <div className="rounded-[2.6rem] bg-slate-900 p-2.5 shadow-2xl ring-1 ring-slate-700">
        <div className="relative overflow-hidden rounded-[2.1rem] bg-gradient-to-b from-brand-600 to-brand-800 pb-6">
          <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-slate-900" />
          <div className="mt-3 flex items-center justify-between px-5 text-[10px] font-medium text-white/80"><span>9:41</span><span className="flex items-center gap-1"><Signal className="size-3" /><Wifi className="size-3" /><BatteryFull className="size-3.5" /></span></div>
          <div className="mx-3 mt-4 rounded-2xl bg-white/95 p-3 shadow-lg">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" className="size-6 rounded-md" />
              <span className="text-[10px] font-semibold text-slate-500">COVERAGE · now</span>
            </div>
            <div className="mt-1.5 text-xs font-semibold text-slate-900">New shift offer near you</div>
            <div className="text-[11px] leading-snug text-slate-600">Thu 9–5 · Orlando · pay shown up front. Tap to accept.</div>
          </div>
          <div className="mx-3 mt-3 rounded-2xl bg-white/15 p-3 text-white">
            <div className="text-[10px] uppercase tracking-wide text-white/70">Today</div>
            <div className="mt-1 text-sm font-semibold">Downtown Orlando</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white py-2 text-center text-[11px] font-semibold text-brand-700">Punch in</div>
              <div className="rounded-lg bg-white/20 py-2 text-center text-[11px] font-semibold">Start lunch</div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-3 px-6">
            {[0, 1, 2, 3].map((i) =>
              i === 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src="/icons/icon-192.png" alt="" className="aspect-square rounded-xl" />
              ) : (
                <div key={i} className="aspect-square rounded-xl bg-white/15" />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "Get the app": installs the web app from the browser. Android/Chrome: the real install prompt.
 * iPhone: Share → Add to Home Screen steps. Computer: a QR code to open the site on a phone.
 */
export function GetTheApp({ qr, compact }: { qr: string; compact?: boolean }) {
  const [evt, setEvt] = useState<Prompt | null>(null);
  const [show, setShow] = useState<"ios" | "android" | "desktop" | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(/iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : "desktop");
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const on = (e: Event) => (e.preventDefault(), setEvt(e as Prompt));
    window.addEventListener("beforeinstallprompt", on);
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  const tap = async (which: "ios" | "android") => {
    if (which === "android" && evt && platform !== "ios") {
      await evt.prompt();
      const r = await evt.userChoice;
      if (r.outcome === "accepted") setInstalled(true);
      setEvt(null);
      return;
    }
    setShow(platform === "desktop" ? "desktop" : which);
  };

  if (installed) {
    return <p className="flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" /> The app is installed on this device.</p>;
  }
  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap gap-3 ${compact ? "" : "justify-center lg:justify-start"}`}>
        <StoreButton mark={<AppleMark />} small="On iPhone" big="Add to Home Screen" onClick={() => tap("ios")} active={show === "ios"} />
        <StoreButton mark={<AndroidMark />} small="On Android" big="Install the app" onClick={() => tap("android")} active={show === "android"} />
      </div>
      {show === "ios" ? (
        <ol className="list-decimal space-y-1 rounded-xl bg-white/90 p-4 pl-8 text-left text-sm text-slate-700 ring-1 ring-slate-200">
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap <Share className="inline size-4" /> <b>Share</b>, then <b>Add to Home Screen</b>.</li>
          <li>Open it from your home screen, sign in, and turn on notifications.</li>
        </ol>
      ) : null}
      {show === "android" ? (
        <ol className="list-decimal space-y-1 rounded-xl bg-white/90 p-4 pl-8 text-left text-sm text-slate-700 ring-1 ring-slate-200">
          <li>Open this page in <b>Chrome</b>.</li>
          <li>Tap the <b>⋮</b> menu, then <b>Install app</b> (or <b>Add to Home screen</b>).</li>
          <li>Open it from your home screen, sign in, and turn on notifications.</li>
        </ol>
      ) : null}
      {show === "desktop" ? (
        <div className="flex items-center gap-4 rounded-xl bg-white/90 p-4 text-left text-sm text-slate-700 ring-1 ring-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code to open the site on your phone" className="size-28 rounded" />
          <p><Smartphone className="mb-1 size-4 text-accent-600" />Scan with your phone&apos;s camera, then follow the steps on your phone to add the app to your home screen.</p>
        </div>
      ) : null}
      {!compact ? <p className="text-xs text-slate-500">Free. No app store needed, nothing to update. It installs straight from your browser.</p> : null}
    </div>
  );
}
