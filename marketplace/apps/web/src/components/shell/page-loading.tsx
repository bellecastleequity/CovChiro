import { cn } from "@/lib/cn";

/**
 * The logo mark, animated: the navy arc turns one way, the teal arc the other, the centre dot
 * breathes. Shown while a page loads. Reduced motion = the still mark.
 */
export function LoadingMark({ className }: { className?: string }) {
  const turn = { transformOrigin: "60px 60px" } as const;
  return (
    <svg viewBox="12 12 96 96" aria-hidden="true" className={cn("shrink-0", className)}>
      <circle cx="60" cy="60" r="38" className="fill-none stroke-slate-200/70" strokeWidth="17.5" />
      <path d="M88.24 34.57A38 38 0 0 0 23.13 69.19" className="fill-none stroke-brand-600 motion-safe:animate-spin-cw" strokeWidth="17.5" strokeLinecap="round" style={turn} />
      <path d="M35.57 89.11A38 38 0 0 0 90.74 82.34" className="fill-none stroke-accent-500 motion-safe:animate-spin-ccw" strokeWidth="17.5" strokeLinecap="round" style={turn} />
      <circle cx="60" cy="60" r="10.5" className="fill-accent-500 motion-safe:animate-dot-pulse" style={turn} />
    </svg>
  );
}

/**
 * Shown the instant a menu link is clicked (app/<area>/loading.tsx) while the page is fetched: the
 * sidebar and header stay put, a faint outline of a page fills the content area and the animated
 * logo sits on top of it. No data, no client code.
 */
export function PageLoading() {
  return (
    <div className="relative min-h-[60vh]" aria-busy="true" aria-label="Loading">
      <div className="pointer-events-none opacity-60" aria-hidden="true">
        <div className="mb-2 h-4 w-40 rounded bg-slate-200/70" />
        <div className="mb-6 h-8 w-64 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-slate-200/70" />)}
        </div>
        <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="h-5 w-48 rounded bg-slate-200" />
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-4 rounded bg-slate-100" style={{ width: `${92 - i * 9}%` }} />)}
        </div>
      </div>
      <div className="absolute inset-x-0 top-24 flex justify-center motion-safe:animate-fade-in-late">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/90 px-8 py-6 shadow-card ring-1 ring-slate-200 backdrop-blur-sm">
          <LoadingMark className="size-14" />
          <span className="text-sm font-medium text-slate-600">Loading…</span>
        </div>
      </div>
    </div>
  );
}
