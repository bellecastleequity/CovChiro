"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function Countdown({ to, prefix = "Closes in" }: { to: string; prefix?: string }) {
  // Start empty so server and client render the same markup; tick after mount.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="tabular-nums">{prefix} …</span>;
  const ms = +new Date(to) - now;
  if (ms <= 0) return <span>Window closed</span>;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const h = Math.floor(m / 60);
  return (
    <span className="tabular-nums">
      {prefix} {h ? `${h}h ${m % 60}m` : `${m}:${String(s).padStart(2, "0")}`}
    </span>
  );
}

/** Refreshes server data while something live is running (dispatch tracker). */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [seconds, router]);
  return null;
}
