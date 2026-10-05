"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Navigation } from "lucide-react";
import { arrivalPositionAction, onMyWayAction } from "@/app/arrival-actions";
import { Button } from "@/components/ui/button";

type Target = { assignmentId: string } | { token: string };

const ask = (opts: PositionOptions) =>
  new Promise<GeolocationPosition | null>((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), opts);
  });

function form(target: Target, pos: GeolocationPosition | null) {
  const fd = new FormData();
  if ("token" in target) fd.set("token", target.token);
  else fd.set("assignmentId", target.assignmentId);
  if (pos) {
    fd.set("lat", String(pos.coords.latitude));
    fd.set("lng", String(pos.coords.longitude));
  }
  return fd;
}

const clock = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

/**
 * "On my way": asks the phone for its position (a few seconds at most; works without it), tells
 * the clinic, and starts the arrival time.
 */
export function OnMyWayButton({ target, size = "md", className }: { target: Target; size?: "md" | "lg"; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [, start] = useTransition();
  const go = async () => {
    setBusy(true);
    setMsg(null);
    const pos = await ask({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 });
    const r = await onMyWayAction(null, form(target, pos));
    setBusy(false);
    setMsg(r);
    start(() => router.refresh());
  };
  return (
    <div className="space-y-2">
      <Button type="button" size={size} className={className} onClick={go} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
        On my way
      </Button>
      <p className="text-xs text-slate-500">If your phone asks, allow location so the clinic sees your arrival time. Only the time and distance are shared, not your location, and it stops when you clock in.</p>
      {msg?.error ? <p className="text-sm text-red-700">{msg.error}</p> : null}
    </div>
  );
}

/**
 * While this page is open after "On my way": sends the phone's position every so often (the server
 * decides how often a new drive time is worth it) and shows the arrival time the clinic sees.
 */
export function ArrivalSharer({ target, timeZone, etaAt: initialEta, miles: initialMiles }: { target: Target; timeZone: string; etaAt: string | null; miles: number | null }) {
  const [eta, setEta] = useState<{ at: string | null; miles: number | null }>({ at: initialEta, miles: initialMiles });
  const [state, setState] = useState<"on" | "off" | "denied" | "done">("on");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(async () => {
    const pos = await ask({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30_000 });
    if (!pos) {
      setState("denied");
      return;
    }
    const r = await arrivalPositionAction(null, form(target, pos));
    const d = r?.data as { sharing: boolean; etaAt: string | null; miles: number | null; nextInSeconds: number } | null | undefined;
    if (!d) return;
    if (d.etaAt) setEta({ at: d.etaAt, miles: d.miles });
    if (!d.sharing) {
      setState("done");
      return;
    }
    timer.current = setTimeout(() => {
      if (document.visibilityState === "visible") void send();
      else timer.current = setTimeout(() => void send(), 15_000);
    }, Math.max(15, d.nextInSeconds) * 1000);
  }, [target]);

  useEffect(() => {
    if (state !== "on") return;
    timer.current = setTimeout(() => void send(), 2000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [send, state]);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      <div className="flex items-center gap-2 font-medium">
        <Navigation className="size-4" />
        {eta.at ? `The clinic sees: arriving around ${clock(eta.at, timeZone)}${eta.miles != null ? ` · ${eta.miles} mi away` : ""}` : "The clinic knows you're on your way."}
      </div>
      <p className="mt-1 text-xs text-emerald-800">
        {state === "on"
          ? "Keep this page open to keep your arrival time up to date. It stops when you clock in."
          : state === "denied"
            ? "Location is off, so your arrival time won't update. That's fine: the clinic knows you're on your way."
            : state === "done"
              ? "Arrival time sharing has ended."
              : "Arrival time sharing is off."}
      </p>
      {state === "on" ? (
        <button type="button" className="mt-1 text-xs font-medium text-emerald-800 underline" onClick={() => setState("off")}>
          Stop sharing my arrival time
        </button>
      ) : null}
    </div>
  );
}
