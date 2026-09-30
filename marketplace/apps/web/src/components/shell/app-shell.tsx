import Link from "next/link";
import { Bell, LogOut, MailWarning } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { Logo } from "@/components/site/header";
import { getSession } from "@/lib/session";
import { BottomNav, SideNav, type NavItem } from "./nav-link";
import { ResendVerification } from "./resend-verification";

export async function AppShell({ items, root, userId, userName, subtitle, children }: { items: NavItem[]; root: string; userId: string; userName: string; subtitle?: string; children: React.ReactNode }) {
  const b = brand();
  const [unread, session] = await Promise.all([prisma.notification.count({ where: { userId, readAt: null } }), getSession()]);
  const unconfirmedEmail = session && !session.user.emailVerifiedAt ? session.user.email : null;
  return (
    <div className="min-h-dvh bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white px-3 py-4 lg:flex">
        <Link href={root} className="px-3 pb-5">
          <Logo name={b.name} />
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SideNav items={items} root={root} />
        </div>
        <div className="border-t border-slate-100 px-3 pt-3">
          <div className="truncate text-sm font-medium text-slate-900">{userName}</div>
          {subtitle ? <div className="truncate text-xs text-slate-500">{subtitle}</div> : null}
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <Link href={root} className="lg:hidden">
            <Logo name={b.name} />
          </Link>
          <div className="hidden text-sm text-slate-500 lg:block">{subtitle}</div>
          <div className="flex items-center gap-1">
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
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      </div>
      <BottomNav items={items} root={root} />
    </div>
  );
}
