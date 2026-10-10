/**
 * Shown the instant a menu link is clicked (app/<area>/loading.tsx) while the page is fetched: the
 * sidebar and header stay put and this outline fills the content area. No data, no client code.
 */
export function PageLoading() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-4 w-40 rounded bg-slate-200/70" />
      <div className="mb-6 h-8 w-64 rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-slate-200/70" />)}
      </div>
      <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="h-5 w-48 rounded bg-slate-200" />
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-4 rounded bg-slate-100" style={{ width: `${92 - i * 9}%` }} />)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
