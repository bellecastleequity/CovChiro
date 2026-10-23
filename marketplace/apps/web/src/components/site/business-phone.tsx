import { Phone } from "lucide-react";
import { getSettings } from "@cm/services";
import { phoneLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The business line (Settings site.phone / site.phoneLabel) with a Call button. Renders nothing when no
 * number is set. Calls only (owner, Oct 2026): the number is a calling line, so it's never offered for
 * texting; texts are only replies to the texts we send, from the AWS texting number.
 */
export async function BusinessPhone({ variant = "card", title, note, className }: { variant?: "card" | "inline" | "footer"; title?: string; note?: string; className?: string }) {
  const st = await getSettings();
  const phone = st["site.phone"];
  if (!phone) return null;
  const digits = phoneLabel(phone);
  const vanity = st["site.phoneLabel"].trim() || digits;
  const both = vanity !== digits;
  if (variant === "footer") {
    return (
      <div className={cn("text-sm", className)}>
        <a href={`tel:${phone}`} className="font-semibold text-slate-900 hover:text-brand-700">{vanity}</a>
        {both ? <span className="whitespace-nowrap text-slate-500"> · {digits}</span> : null}
        <div className="text-slate-500">Call us</div>
      </div>
    );
  }
  if (variant === "inline") {
    return (
      <span className={className}>
        Call 
        <a href={`tel:${phone}`} className="font-medium text-brand-700 underline">{vanity}</a>
        {both ? ` (${digits})` : ""}
      </span>
    );
  }
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-4 sm:flex sm:items-center sm:gap-4", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{title ?? "Call us"}</div>
        <div className="whitespace-nowrap text-lg font-semibold text-brand-700">{vanity}</div>
        {both ? <div className="whitespace-nowrap text-sm text-slate-500">{digits}</div> : null}
        {note ? <div className="mt-1 text-sm text-slate-500">{note}</div> : null}
      </div>
      <div className="mt-3 flex gap-2 sm:mt-0 sm:shrink-0">
        <a href={`tel:${phone}`} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:flex-none"><Phone className="size-4" />Call</a>
      </div>
    </div>
  );
}
