import Link from "next/link";
import { brand } from "@cm/config";
import { cityLabel, slugify, US_STATES } from "@cm/core";
import { seo } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { getSession, homeFor } from "@/lib/session";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";

const NAV = [
  { href: "/for-clinics", label: "For clinics" },
  { href: "/for-providers", label: "For providers" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/states", label: "Availability" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];

export { Logo } from "./logo";

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

/** Popular cities per live profession/state: internal links that help search engines find the local pages. */
async function footerLocations() {
  const live = await seo.seoLive().catch(() => []);
  const out: { href: string; label: string; jobsHref: string }[] = [];
  for (const p of live.slice(0, 1)) {
    for (const st of p.states.slice(0, 2)) {
      const stSlug = slugify(US_STATES[st]);
      out.push({ href: `/${p.slug}/${stSlug}`, label: `${p.name} coverage in ${US_STATES[st]}`, jobsHref: `/jobs/${p.slug}/${stSlug}` });
      for (const c of (await seo.seoCities(st)).slice(0, 8)) out.push({ href: `/${p.slug}/${stSlug}/${slugify(c)}`, label: `${cityLabel(c)}, ${st}`, jobsHref: `/jobs/${p.slug}/${stSlug}/${slugify(c)}` });
    }
  }
  return out;
}

export async function SiteFooter() {
  const b = brand();
  const locations = await footerLocations();
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
            <li><Link href="/jobs">Open shifts</Link></li>
            {locations[0] ? <li><Link href={locations[0].jobsHref}>{locations[0].label.replace(" coverage in ", " jobs in ")}</Link></li> : null}
            <li><Link href="/chiropractic">Chiropractic</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-slate-900">Company</div>
          <ul className="space-y-1.5 text-slate-600">
            <li><Link href="/blog">Blog</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></li>
          </ul>
        </div>
      </div>
      {locations.length > 1 ? (
        <div className="container-page border-t border-slate-100 py-6 text-sm">
          <div className="mb-2 font-semibold text-slate-900">Coverage near you</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-slate-600">
            {locations.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-brand-700">{l.label}</Link></li>)}
          </ul>
        </div>
      ) : null}
      <div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400">© {new Date().getFullYear()} {b.name}. No patient information is collected or stored on this platform.</div>
    </footer>
  );
}
