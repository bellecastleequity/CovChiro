import Link from "next/link";
import { brand } from "@cm/config";
import { LinkButton } from "@/components/ui/button";
import { getSession, homeFor } from "@/lib/session";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import QRCode from "qrcode";
import { env } from "@cm/config";
import { GetTheApp } from "./get-the-app";
import { TrustBadges } from "./trust-badges";
import { getSettings } from "@cm/services";
import { liveMarket, serviceWord } from "@/lib/seo";

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
            <LinkButton href={homeFor(s.actor.role)} size="sm">
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
        <MobileMenu nav={NAV} signedIn={!!s} home={s ? homeFor(s.actor.role) : "/signup"} />
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const b = brand();
  const qr = await QRCode.toDataURL(env().APP_BASE_URL || "https://coverageoncall.com", { margin: 1, width: 200 });
  const st = await getSettings();
  const live = await liveMarket().catch(() => []);
  const socials = [
    { href: st["site.instagramUrl"], label: "Instagram", icon: <InstagramIcon /> },
    { href: st["site.youtubeUrl"], label: "YouTube", icon: <YouTubeIcon /> },
  ].filter((x) => x.href);
  return (
    <footer className="mt-24 border-t border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/70">
        <div className="container-page py-10">
          <TrustBadges />
        </div>
      </div>
      <div className="container-page grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo name={b.name} />
          <p className="mt-3 text-sm text-slate-500">{b.tagline}</p>
          {socials.length ? (
            <div className="mt-4 flex items-center gap-2">
              {socials.map((x) => (
                <a key={x.label} href={x.href} target="_blank" rel="noopener noreferrer" aria-label={`${b.name} on ${x.label}`} title={`@coverageoncall on ${x.label}`} className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-brand-600 hover:text-white">
                  {x.icon}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-slate-900">Clinics</div>
          <ul className="space-y-1.5 text-slate-600">
            <li><Link href="/for-clinics">Pricing</Link></li>
            <li><Link href="/signup?role=clinic">Post a shift</Link></li>
            <li><Link href="/how-it-works">How it works</Link></li>
            <li><Link href="/personal-injury-clinics">Personal injury clinics</Link></li>
            {live.map(({ profession: p, state: s }) => (
              <li key={`${p.slug}/${s.slug}`}><Link href={`/${p.slug}/${s.slug}`}>{serviceWord(p.slug)} coverage in {s.name}</Link></li>
            ))}
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
            <li><Link href="/blog">Blog</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></li>
            <li><Link href="/privacy">Privacy policy</Link></li>
            <li><Link href="/terms">Terms of service</Link></li>
          </ul>
        </div>
      </div>
      <div className="container-page flex flex-col items-start justify-between gap-4 border-t border-slate-100 py-6 sm:flex-row sm:items-center">
        <div>
          <div className="text-sm font-semibold text-slate-900">Get the app</div>
          <div className="text-xs text-slate-500">Offers, time clock and alerts on your phone.</div>
        </div>
        <GetTheApp qr={qr} compact />
      </div>
      <div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400">© {new Date().getFullYear()} {b.name}. No patient information is collected or stored on this platform.</div>
    </footer>
  );
}

/** Brand marks drawn inline (lucide no longer ships brand logos). */
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
      <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.4-1.6.5-4.8.5-4.8s0-3.2-.5-4.8zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
    </svg>
  );
}
