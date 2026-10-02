"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { saveNavOrderAction } from "@/app/account-actions";
import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowUpDown, BadgeCheck, ChevronDown, ChevronUp, Clock, DatabaseBackup, GripVertical, BarChart3, Bell, Briefcase, Building2, CalendarDays, ClipboardList, CreditCard, FileText, Gauge, GraduationCap, Inbox, LayoutDashboard, ListChecks,
  LogOut, Map, MapPin, Menu, Megaphone, MessageSquare, PlusCircle, Repeat, ScrollText, Search, Settings, ShieldCheck, Gift, Tag, UserRound, Users, Wallet, X,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const ICONS = {
  dashboard: LayoutDashboard, board: Search, shifts: CalendarDays, offers: Inbox, credentials: BadgeCheck, availability: CalendarDays, earnings: Wallet,
  messages: MessageSquare, profile: UserRound, post: PlusCircle, billing: CreditCard, locations: MapPin, team: Users, verification: ShieldCheck,
  providers: Briefcase, clinics: Building2, payouts: Wallet, payments: CreditCard, promo: Tag, leads: Megaphone, analytics: BarChart3, states: Map,
  standing: Repeat, rates: Gauge, emergency: AlertTriangle, settings: Settings, tasks: ListChecks, audit: ScrollText, notifications: Bell, docs: FileText, list: ClipboardList, academy: GraduationCap, refer: Gift, timeclock: Clock, backup: DatabaseBackup,
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

export function SideNav({ items, root, customized }: { items: NavItem[]; root: string; customized?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setOrder(items);
  }, [items, editing]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setOrder(next);
  };
  const save = async (hrefs: string[] | null) => {
    setBusy(true);
    const r = await saveNavOrderAction(root, hrefs);
    setBusy(false);
    setMsg("error" in r ? (r.error ?? null) : (r.ok ?? null));
    setEditing(false);
    router.refresh();
    setTimeout(() => setMsg(null), 3000);
  };

  if (editing) {
    return (
      <div>
        <p className="mb-2 px-3 text-xs text-slate-500">Drag items, or use the arrows. Then save.</p>
        <ul className="space-y-0.5">
          {order.map((i, n) => {
            const Icon = ICONS[i.icon];
            return (
              <li
                key={i.href}
                draggable
                onDragStart={() => setDrag(n)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (drag !== null && drag !== n) (move(drag, n), setDrag(n));
                }}
                onDragEnd={() => setDrag(null)}
                className={cn("flex cursor-grab items-center gap-2 rounded-xl border px-2 py-1.5 text-sm font-medium text-slate-700 active:cursor-grabbing", drag === n ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white")}
              >
                <GripVertical className="size-4 shrink-0 text-slate-300" />
                <Icon className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                <button type="button" onClick={() => move(n, n - 1)} disabled={n === 0} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label={`Move ${i.label} up`}><ChevronUp className="size-4" /></button>
                <button type="button" onClick={() => move(n, n + 1)} disabled={n === order.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label={`Move ${i.label} down`}><ChevronDown className="size-4" /></button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2 px-1">
          <button type="button" disabled={busy} onClick={() => save(order.map((i) => i.href))} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">Save order</button>
          <button type="button" disabled={busy} onClick={() => (setOrder(items), setEditing(false))} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={busy} onClick={() => save(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">Reset to default</button>
        </div>
      </div>
    );
  }

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
      <div className="pt-2">
        <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600">
          <ArrowUpDown className="size-3.5" /> Reorder menu{customized ? " (custom)" : ""}
        </button>
        {msg ? <p className="px-3 text-xs text-emerald-700">{msg}</p> : null}
      </div>
    </nav>
  );
}

/**
 * Phone / narrow-window navigation: the four main items plus "More", which opens the full menu
 * (every item the desktop sidebar has, with badges). Closes on navigation or Escape.
 */
export function BottomNav({ items, ordered, root }: { items: NavItem[]; ordered?: NavItem[]; root: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  const main = items.filter((i) => i.mobile).slice(0, 4);
  const rest = items.filter((i) => !main.includes(i));
  const restActive = rest.some((i) => isActive(path, i.href, root));
  const restBadge = rest.some((i) => i.badge);
  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-sm font-semibold text-slate-900">Menu</span>
              <button onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close menu"><X className="size-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {(ordered ?? items).map((i) => {
                const Icon = ICONS[i.icon];
                const active = isActive(path, i.href, root);
                return (
                  <Link key={i.href} href={i.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium", active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100")}>
                    <Icon className={cn("size-5", active ? "text-accent-600" : "text-slate-400")} />
                    <span className="flex-1">{i.label}</span>
                    {i.badge ? <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{i.badge}</span> : null}
                  </Link>
                );
              })}
            </div>
            <form action="/api/auth/logout" method="post" className="mt-2 border-t border-slate-100 px-3 pt-3">
              <button className="flex items-center gap-3 py-2 text-sm text-slate-500 hover:text-slate-900"><LogOut className="size-5" /> Sign out</button>
            </form>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t print:hidden border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${main.length + 1}, minmax(0, 1fr))` }}>
        {main.map((i) => {
          const Icon = ICONS[i.icon];
          const active = isActive(path, i.href, root);
          return (
            <Link key={i.href} href={i.href} className={cn("relative flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium", active ? "text-brand-700" : "text-slate-500")}>
              <Icon className="size-5" />
              <span className="max-w-full truncate">{i.label}</span>
              {i.badge ? <span className="absolute right-1/4 top-1 size-2 rounded-full bg-brand-600" /> : null}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", restActive ? "text-brand-700" : "text-slate-500")}>
          <Menu className="size-5" />
          More
          {restBadge ? <span className="absolute right-1/4 top-1 size-2 rounded-full bg-brand-600" /> : null}
        </button>
      </nav>
    </>
  );
}
