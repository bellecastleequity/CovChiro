"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the page when `at` arrives, with a live countdown ("in 3:12"). */
export function RefreshAt({ at }: { at: string | null }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!at) return;
    const due = +new Date(at);
    const tick = () => {
      const ms = due - Date.now();
      setLeft(ms);
      if (ms <= 0) router.refresh();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [at, router]);
  if (!at || left === null || left <= 0) return null;
  const s = Math.ceil(left / 1000);
  const label = s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return <span className="tabular-nums">in {label}</span>;
}
