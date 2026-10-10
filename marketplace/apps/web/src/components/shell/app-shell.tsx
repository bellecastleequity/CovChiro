import Link from "next/link";
import { ArrowLeftRight, Bell, PlusCircle, LifeBuoy, LogOut, MailWarning, Siren } from "lucide-react";
import { clinicHelp } from "@/lib/help/clinic";
import { providerHelp } from "@/lib/help/provider";
import { brand, SETTINGS } from "@cm/config";
import { orderNav } from "@cm/core";
import { navprefs } from "@cm/services";
import { searchPagesFor } from "@/lib/search-pages";
import { GlobalSearch, type SearchEntry } from "./global-search";
import { AppInstall } from "./app-install";
import { prisma } from "@cm/db";
import { Logo } from "@/components/site/header";
import { LogoMark } from "@/components/site/logo";
import { SetupStatus } from "./setup-status";
import type { SetupStatus as SetupStatusData } from "@/lib/setup";
import { getSession } from "@/lib/session";
import { BottomNav, SideNav, type NavItem } from "./nav-link";
import { ResendVerification } from "./resend-verification";

export async function AppShell({ items, root, userId, userName, userPhoto, subtitle, setup, otherSide, addSide, footnote, children }: { items: NavItem[]; root: string; userId: string; userName: string; userPhoto?: string | null; subtitle?: string; setup?: SetupStatusData | null; /** The login's other workspace (clinic owner who also takes shifts): a switch in the header and sidebar. */ otherSide?: { to: "CLINIC" | "PROVIDER"; label: string } | null; /** No other side yet: a link to add it (clinic owner → take shifts; provider → own clinic). */ addSide?: { href: string; label: string } | null; /** Small print under the sign-out link (admin: the installed release). */ footnote?: React.ReactNode; children: React.ReactNode }) {
  const b = brand();
  const [unread, session, savedOrder] = await Promise.all([prisma.notification.count({ where: { userId, readAt: null } }), getSession(), navprefs.getNavOrder(userId, root)]);
  const ordered = orderNav(items, root, savedOrder);
  const unconfirmedEmail = session && !session.user.emailVerifiedAt ? session.user.email : null;
  // Search: the menu + extra pages for this area (+ every setting for admins).
  const extra = searchPagesFor(root);
  const seen = new Set(extra.map((e) => e.href));
  const help = root === "/clinic" ? clinicHelp : root === "/provider" ? providerHelp : null;
  const entries: SearchEntry[] = [
    ...extra,
    ...(help ? help.articles.map((a) => ({ label: a.title, href: `${help.base}/${a.slug}`, section: "Help", keywords: `${a.keywords} ${a.summary}` })) : []),
    ...items.filter((i) => !seen.has(i.href)).map((i) => ({ label: i.label, href: i.href, section: "Menu" })),
    ...(root === "/admin"
      ? Object.entries(SETTINGS).map(([key, d]) => ({ label: d.label, href: `/admin/settings#s-${key}`, section: `Settings · ${d.group}`, keywords: `${key} ${(d.help ?? "").slice(0, 160)}`, kind: "setting" as const }))
      : []),
  ];
  const placeholder = root === "/admin" ? "Search pages, settings, providers, clinics, shifts, leads…" : root === "/clinic" ? "Search pages, shifts, providers, locations…" : "Search pages and your shifts…";
  return (
    <div className="min-h-dvh bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 print:!hidden flex-col border-r border-slate-200 bg-white px-3 py-4 lg:flex">
        <Link href={root} className="px-3 pb-5">
          <Logo name={b.name} />
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SideNav items={ordered} root={root} customized={!!savedOrder?.length} />
        </div>
        <div className="border-t border-slate-100 px-3 pt-3">
          <div className="flex items-center gap-2">
            {userPhoto ? <img src={`/api/files/${userPhoto}`} alt="" className="size-7 shrink-0 rounded-full object-cover" /> : null}
            <div className="truncate text-sm font-medium text-slate-900">{userName}</div>
          </div>
          {subtitle ? <div className="truncate text-xs text-slate-500">{subtitle}</div> : null}
          {otherSide ? (
            <form action="/api/workspace" method="post" className="mt-2">
              <input type="hidden" name="to" value={otherSide.to} />
              <button className="flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand-800"><ArrowLeftRight className="size-4" /> {otherSide.label}</button>
            </form>
          ) : addSide ? (
            <Link href={addSide.href} className="mt-2 flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand-800"><PlusCircle className="size-4" /> {addSide.label}</Link>
          ) : null}
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
          {footnote ? <div className="mt-2 text-xs text-slate-400">{footnote}</div> : null}
        </div>
      </aside>
      <div className="min-w-0 overflow-x-clip lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <Link href={root} className="shrink-0 lg:hidden" aria-label={b.name}>
            {/* Phones: the mark only, so the setup chip, help and alerts fit. */}
            <LogoMark className="size-8 sm:hidden" />
            <span className="hidden sm:block"><Logo name={b.name} /></span>
          </Link>
          <div className="hidden min-w-0 max-w-48 shrink truncate text-sm text-slate-500 xl:block">{subtitle}</div>
          <div className="flex min-w-0 flex-1 justify-end md:justify-center md:px-4">
            <GlobalSearch entries={entries} placeholder={placeholder} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {otherSide ? (
              <form action="/api/workspace" method="post">
                <input type="hidden" name="to" value={otherSide.to} />
                <button className="mr-1 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-2.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50" title={otherSide.label} aria-label={otherSide.label}>
                  <ArrowLeftRight className="size-4" /><span className="hidden md:inline">{otherSide.to === "CLINIC" ? "Clinic" : "Provider"}</span>
                </button>
              </form>
            ) : null}
            {setup ? <SetupStatus status={setup} /> : null}
            {help ? (
              <Link href={`${help.base}/urgent`} className="mr-1 hidden items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 md:inline-flex">
                <Siren className="size-4" />
                Need help now?
              </Link>
            ) : null}
            {help ? (
              <Link href={help.base} className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Help center" title="Help">
                <LifeBuoy className="size-5" />
              </Link>
            ) : null}
            <Link href={`${root}/notifications`} className="relative grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
              <Bell className="size-5" />
              {unread ? <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span> : null}
            </Link>
            <form action="/api/auth/logout" method="post" className="lg:hidden">
              <button className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Sign out">
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
        </header>
        {unconfirmedEmail ? (
          <div className="border-b border-amber-200 bg-amber-50">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm text-amber-900 sm:px-6">
              <MailWarning className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 basis-72">
                Please confirm your email. We sent a link to <strong className="break-all">{unconfirmedEmail}</strong> — check your spam folder too.
              </span>
              <ResendVerification className="max-w-full" />
            </div>
          </div>
        ) : null}
        <main className="app-main mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          {root !== "/admin" ? <div className="print:hidden"><AppInstall compact /></div> : null}
          {children}
        </main>
      </div>
      <BottomNav items={items} ordered={ordered} root={root} />
    </div>
  );
}
