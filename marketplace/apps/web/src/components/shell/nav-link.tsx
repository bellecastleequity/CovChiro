"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck, BarChart3, Bell, Briefcase, Building2, CalendarDays, ClipboardList, CreditCard, FileText, Gauge, Inbox, LayoutDashboard, ListChecks,
  Map, MapPin, Megaphone, MessageSquare, PlusCircle, ScrollText, Search, Settings, ShieldCheck, Tag, UserRound, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const ICONS = {
  dashboard: LayoutDashboard, board: Search, shifts: CalendarDays, offers: Inbox, credentials: BadgeCheck, availability: CalendarDays, earnings: Wallet,
  messages: MessageSquare, profile: UserRound, post: PlusCircle, billing: CreditCard, locations: MapPin, team: Users, verification: ShieldCheck,
  providers: Briefcase, clinics: Building2, payouts: Wallet, payments: CreditCard, promo: Tag, leads: Megaphone, analytics: BarChart3, states: Map,
  rates: Gauge, settings: Settings, tasks: ListChecks, audit: ScrollText, notifications: Bell, docs: FileText, list: ClipboardList,
} as const;
export type IconName = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  mobile?: boolean;
}

function isActive(path: string, href: string, root: string) {
  return href === root ? path === root : path === href || path.startsWith(href + "/");
}

export function SideNav({ items, root }: { items: NavItem[]; root: string }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = isActive(path, i.href, root);
        return (
          <Link key={i.href} href={i.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium", active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
            <Icon className={cn("size-4.5", active ? "text-accent-600" : "text-slate-400")} />
            <span className="flex-1">{i.label}</span>
            {i.badge ? <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{i.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items, root }: { items: NavItem[]; root: string }) {
  const path = usePathname();
  const mobile = items.filter((i) => i.mobile).slice(0, 5);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${mobile.length}, minmax(0, 1fr))` }}>
      {mobile.map((i) => {
        const Icon = ICONS[i.icon];
        const active = isActive(path, i.href, root);
        return (
          <Link key={i.href} href={i.href} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-brand-700" : "text-slate-500")}>
            <Icon className="size-5" />
            {i.label}
            {i.badge ? <span className="absolute right-1/4 top-1 size-2 rounded-full bg-brand-600" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
