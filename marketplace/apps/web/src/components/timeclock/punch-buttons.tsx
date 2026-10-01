"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coffee, Loader2, LogIn, LogOut, Play } from "lucide-react";
import { punchAction } from "@/app/timeclock-actions";
import { buttonClass } from "@/components/ui/button";

const META = {
  IN: { label: "Punch in", icon: LogIn, variant: "primary" },
  BREAK_START: { label: "Start lunch", icon: Coffee, variant: "outline" },
  BREAK_END: { label: "End lunch", icon: Play, variant: "primary" },
  OUT: { label: "Punch out", icon: LogOut, variant: "primary" },
} as const;

/** Big punch buttons. Asks the phone for its location (a few seconds at most); punching works without it. */
export function PunchButtons({ assignmentId, next, tz }: { assignmentId: string; next: (keyof typeof META)[]; tz: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [, start] = useTransition();

  const where = () =>
    new Promise<GeolocationPosition | null>((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 });
    });

  const go = async (kind: keyof typeof META) => {
    if (kind === "OUT" && !window.confirm("Punch out for the day? Your timesheet goes to the clinic to sign off.")) return;
    setBusy(kind);
    setMsg(null);
    const pos = await where();
    const fd = new FormData();
    fd.set("assignmentId", assignmentId);
    fd.set("kind", kind);
    fd.set("tz", tz);
    if (pos) {
      fd.set("lat", String(pos.coords.latitude));
      fd.set("lng", String(pos.coords.longitude));
      fd.set("accuracy", String(pos.coords.accuracy));
    }
    const r = await punchAction(null, fd);
    setBusy(null);
    setMsg(r);
    start(() => router.refresh());
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {next.map((k) => {
          const m = META[k];
          const Icon = m.icon;
          return (
            <button key={k} type="button" disabled={!!busy} onClick={() => go(k)} className={buttonClass(m.variant, "lg", "w-full py-4 text-base")}>
              {busy === k ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
              {m.label}
            </button>
          );
        })}
      </div>
      {msg?.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{msg.error}</p> : null}
      {msg?.ok ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg.ok}</p> : null}
    </div>
  );
}
