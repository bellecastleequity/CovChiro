"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { LeadForm } from "./lead-form";

/** Clinic welcome offer, shown once per browser after a short delay or on exit intent. */
export function WelcomePopup({ percent }: { percent: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem("cm_welcome_seen") === "1";
    } catch {}
    if (seen) return;
    const show = () => {
      setOpen(true);
      try {
        localStorage.setItem("cm_welcome_seen", "1");
      } catch {}
      cleanup();
    };
    const t = setTimeout(show, 25_000);
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) show();
    };
    document.addEventListener("mouseout", onLeave);
    const cleanup = () => {
      clearTimeout(t);
      document.removeEventListener("mouseout", onLeave);
    };
    return cleanup;
  }, []);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
          <X className="size-5" />
        </button>
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">For clinics</div>
        <h2 id="welcome-title" className="mt-1 text-2xl font-semibold">
          {percent}% off your first coverage shift
        </h2>
        <p className="mt-2 text-sm text-slate-600">Get a personal code by email. Use it when you post your first shift.</p>
        <div className="mt-5">
          <LeadForm source="popup" audience="CLINIC" compact />
        </div>
      </div>
    </div>
  );
}
