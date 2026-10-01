import Link from "next/link";
import { cn } from "@/lib/cn";

/** Prospecting workspace: switch between provider and clinic prospects. */
export function ProspectSwitch({ current }: { current: "providers" | "clinics" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cn("rounded-lg px-4 py-1.5 text-sm font-medium", on ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{label}</Link>
  );
  return (
    <div className="mb-6 inline-flex rounded-xl bg-slate-100 p-1">
      {tab("/admin/growth/prospects/providers", "Providers", current === "providers")}
      {tab("/admin/growth/prospects", "Clinics", current === "clinics")}
    </div>
  );
}
