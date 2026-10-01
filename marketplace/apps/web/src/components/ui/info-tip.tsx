"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/** A small ⓘ that explains a field. Opens on hover, focus or tap (phones); closes on tap-away or Escape. */
export function InfoTip({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("pointerdown", away), document.removeEventListener("keydown", esc));
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open} onClick={(e) => (e.preventDefault(), e.stopPropagation(), setOpen((o) => !o))} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="ml-1 rounded-full text-slate-400 hover:text-brand-600 focus:text-brand-600 focus:outline-none">
        <Info className="size-4" />
      </button>
      {open ? (
        <span id={id} role="tooltip" className="absolute left-1/2 top-6 z-30 w-72 max-w-[80vw] -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lg sm:left-0 sm:translate-x-0">
          {children}
        </span>
      ) : null}
    </span>
  );
}
