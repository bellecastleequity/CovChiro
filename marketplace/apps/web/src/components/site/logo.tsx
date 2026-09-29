import { cn } from "@/lib/cn";

/**
 * Brand logo. The mark is an inline copy of public/brand/logo-mark.svg (logo
 * navy #282472 + teal #22C4BE); the wordmark is live text in the brand font,
 * so the name still comes from BRAND_NAME config.
 */
export function LogoMark({ className, tone = "color" }: { className?: string; tone?: "color" | "white" }) {
  return (
    <svg viewBox="12 12 96 96" aria-hidden="true" className={cn("shrink-0", className)}>
      <path d="M88.24 34.57A38 38 0 0 0 23.13 69.19" stroke={tone === "white" ? "#ffffff" : "#282472"} strokeWidth="17.5" strokeLinecap="round" fill="none" />
      <path d="M35.57 89.11A38 38 0 0 0 90.74 82.34" stroke="#22C4BE" strokeWidth="17.5" strokeLinecap="round" fill="none" />
      <circle cx="60" cy="60" r="10.5" fill="#22C4BE" />
    </svg>
  );
}

/** "CoverageOnCall" → ["Coverage", "OnCall"]; "Acme Health" → ["Acme", " Health"]. */
function splitName(name: string): [string, string] {
  const camel = name.match(/^([A-Z]?[a-z]+)([A-Z].*)$/);
  if (camel) return [camel[1], camel[2]];
  const i = name.indexOf(" ");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

const SIZES = { sm: { mark: "size-7", text: "text-lg" }, md: { mark: "size-8", text: "text-xl" }, lg: { mark: "size-11", text: "text-3xl" } };

export function Logo({ name, size = "md", tone = "color", className }: { name: string; size?: keyof typeof SIZES; tone?: "color" | "white"; className?: string }) {
  const [first, rest] = splitName(name);
  const s = SIZES[size];
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark className={s.mark} tone={tone} />
      <span className={cn("font-display font-semibold leading-none tracking-tight", s.text)}>
        <span className={tone === "white" ? "text-white" : "text-brand-600"}>{first}</span>
        <span className="text-accent-500">{rest}</span>
      </span>
    </span>
  );
}
