import { FlaskConical } from "lucide-react";

/** Test site only: a slim strip on every page so it's never mistaken for the live site. */
export function SandboxBar() {
  return (
    <div className="relative z-50 flex items-center justify-center gap-2 bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950 print:hidden">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>
        TEST SITE: demo data, no real money. Emails and texts go to the{" "}
        <a href="/admin/sandbox#outbox" className="underline underline-offset-2">Test outbox</a>.
      </span>
      <a href="/api/sandbox/return" className="ml-2 rounded-full bg-amber-950/10 px-2 py-0.5 underline-offset-2 hover:underline">Back to admin</a>
    </div>
  );
}
