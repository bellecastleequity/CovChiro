"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Download, Share, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/**
 * "Install the app" + "Turn on notifications". Android/desktop Chrome get an install button;
 * iPhone shows the Share → Add to Home Screen steps (Apple only allows notifications for apps
 * added to the home screen). compact = dismissible dashboard banner.
 */
export function AppInstall({ compact }: { compact?: boolean }) {
  const [installEvt, setInstallEvt] = useState<Prompt | null>(null);
  const [state, setState] = useState<"unsupported" | "default" | "granted" | "denied" | "subscribed">("default");
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const sa = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIos(isIos);
    setStandalone(sa);
    const onPrompt = (e: Event) => (e.preventDefault(), setInstallEvt(e as Prompt));
    window.addEventListener("beforeinstallprompt", onPrompt);
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "subscribed" : (Notification.permission as "default" | "granted" | "denied"));
    })().catch(() => setState("unsupported"));
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("cm_app_banner") === "hidden";
    } catch {
      /* private mode */
    }
    setHidden(compact ? dismissed : false);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [compact]);

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm as "denied");
        setMsg("Notifications are blocked. Turn them on for this site in your browser or phone settings.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error((await r.json()).error ?? "failed");
      setState("subscribed");
      setMsg("Notifications are on for this device.");
    } catch (e) {
      setMsg(e instanceof Error && e.message !== "failed" ? e.message : "Couldn't turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("default");
    setMsg("Notifications are off for this device.");
  };
  const dismiss = () => {
    try {
      localStorage.setItem("cm_app_banner", "hidden");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  if (hidden) return null;
  if (compact && (state === "subscribed" || state === "unsupported") && (standalone || !installEvt) && !(ios && !standalone)) return null;

  const iosNeedsInstall = ios && !standalone;
  return (
    <div className={compact ? "relative mb-6 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm" : "space-y-3 text-sm"}>
      {compact ? <button onClick={dismiss} className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Dismiss"><X className="size-4" /></button> : null}
      {compact ? <p className="pr-6 font-medium text-slate-900">Get offers and updates the moment they happen</p> : null}
      <p className="text-slate-600">Install the app on your phone and turn on notifications. It&apos;s free, no app store needed{iosNeedsInstall ? "" : ", and you can turn it off any time"}.</p>
      {iosNeedsInstall ? (
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>In Safari, tap <Share className="inline size-4" /> <b>Share</b> at the bottom of the screen.</li>
          <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open the app from your home screen and come back here to turn on notifications.</li>
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {installEvt && !standalone ? (
          <button type="button" className={buttonClass("outline", "sm")} onClick={async () => (await installEvt.prompt(), setInstallEvt(null))}>
            <Download className="size-4" /> Install the app
          </button>
        ) : null}
        {!iosNeedsInstall && state !== "unsupported" ? (
          state === "subscribed" ? (
            <button type="button" className={buttonClass("ghost", "sm")} onClick={disable}><BellOff className="size-4" /> Turn off on this device</button>
          ) : (
            <button type="button" disabled={busy || state === "denied"} className={buttonClass("primary", "sm")} onClick={enable}><Bell className="size-4" /> Turn on notifications</button>
          )
        ) : null}
      </div>
      {state === "denied" && !msg ? <p className="text-xs text-slate-600">Notifications are blocked for this site. Allow them in your browser (the lock icon by the address) or phone settings, then reload.</p> : null}
      {state === "unsupported" && !iosNeedsInstall ? <p className="text-xs text-slate-500">This browser doesn&apos;t support notifications. Try Chrome, Edge, Firefox or Safari.</p> : null}
      {msg ? <p className="text-xs text-slate-600">{msg}</p> : null}
    </div>
  );
}
