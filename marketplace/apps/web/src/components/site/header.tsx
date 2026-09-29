import Link from "next/link";
import { brand } from "@cm/config";
import { LinkButton } from "@/components/ui/button";
import { getSession, homeFor } from "@/lib/session";
import { MobileMenu } from "./mobile-menu";

const NAV = [
  { href: "/for-clinics", label: "For clinics" },
  { href: "/for-providers", label: "For providers" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/states", label: "Availability" },
  { href: "/faq", label: "FAQ" },
];

export function Logo({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2 font-semibold text-slate-900">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">{name.slice(0, 1)}</span>
      <span>{name}</span>
    </span>
  );
}

export async function SiteHeader() {
  const b = brand();
  const s = await getSession();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label={`${b.name} home`}>
          <Logo name={b.name} />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-slate-600 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-slate-900">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 sm:flex">
          {s ? (
            <LinkButton href={homeFor(s.user.role)} size="sm">
              Open dashboard
            </LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="ghost" size="sm">
                Sign in
              </LinkButton>
              <LinkButton href="/signup" size="sm">
                Get started
              </LinkButton>
            </>
          )}
        </div>
        <MobileMenu nav={NAV} signedIn={!!s} home={s ? homeFor(s.user.role) : "/signup"} />
      </div>
    </header>
  );
}

export function SiteFooter() {
  const b = brand();
  return (
    <footer className="mt-24 border-t border-slate-200 bg-white">
      <div className="container-page grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo name={b.name} />
          <p className="mt-3 text-sm text-slate-500">{b.tagline}</p>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-slate-900">Clinics</div>
          <ul className="space-y-1.5 text-slate-600">
            <li><Link href="/for-clinics">Pricing</Link></li>
            <li><Link href="/signup?role=clinic">Post a shift</Link></li>
            <li><Link href="/how-it-works">How it works</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-slate-900">Providers</div>
          <ul className="space-y-1.5 text-slate-600">
            <li><Link href="/for-providers">Why join</Link></li>
            <li><Link href="/signup?role=provider">Create a profile</Link></li>
            <li><Link href="/chiropractic">Chiropractic</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-slate-900">Company</div>
          <ul className="space-y-1.5 text-slate-600">
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400">© {new Date().getFullYear()} {b.name}. No patient information is collected or stored on this platform.</div>
    </footer>
  );
}
