import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/photo";

/** A clinic's logo, or its initials when it hasn't uploaded one. */
export function ClinicLogo({ logoUrl, name, size = "md", className }: { logoUrl: string | null | undefined; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "size-8" : size === "lg" ? "size-16" : "size-11";
  const initials = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "C";
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- private file served by /api/files
    <img src={photoSrc(logoUrl, size === "lg" ? "full" : "thumb")} alt={`${name} logo`} className={cn(box, "shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-0.5", className)} />
  ) : (
    <div aria-hidden className={cn(box, "grid shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-semibold text-brand-700", size === "lg" && "text-lg", className)}>{initials}</div>
  );
}
