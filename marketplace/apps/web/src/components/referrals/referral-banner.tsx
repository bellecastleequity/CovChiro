"use client";

import { useState } from "react";
import { ChevronDown, Gift } from "lucide-react";
import { cn } from "@/lib/cn";
import { SharePanel } from "./share-panel";

/**
 * Dashboard referral banner: one eye-catching line ("Earn $20 for referring a provider or
 * clinic" + Claim). Tapping it opens the full note: the ground-floor welcome, how the reward
 * works, the person's own link with share buttons, and what they've earned so far.
 */
export function ReferralBanner({
  kind,
  you,
  friend,
  link,
  brandName,
  message,
  justJoined,
  joined,
  earned,
  referHref,
}: {
  kind: "provider" | "clinic";
  you: string;
  friend: string;
  link: string;
  brandName: string;
  message: string;
  justJoined: boolean;
  joined: number;
  earned: string | null;
  referHref: string;
}) {
  const [open, setOpen] = useState(false);
  const Amount = () => <span className="rounded-md bg-amber-300/20 px-1.5 font-bold text-amber-300 ring-1 ring-amber-300/40">{you}</span>;
  return (
    <section className="mb-6 overflow-hidden rounded-2xl shadow-card ring-1 ring-brand-700/20">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="referral-details"
        onClick={() => setOpen((o) => !o)}
        className="group relative flex w-full items-center gap-3 overflow-hidden bg-gradient-to-r from-brand-700 via-brand-600 to-accent-600 px-4 py-3 text-left text-white sm:px-5"
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-shine" />
        <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
          <Gift className="size-5 text-amber-300" />
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex size-2.5">
            <span className="absolute inline-flex size-full rounded-full bg-amber-300 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-300" />
          </span>
        </span>
        <span className="relative min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          <span className="sm:hidden">Earn <Amount /> per referral</span>
          <span className="hidden sm:inline">Earn <Amount /> for referring a provider or clinic</span>
        </span>
        <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-brand-700 shadow-sm transition group-hover:bg-accent-50 group-hover:shadow">
          {open ? "Hide" : "Claim"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      <div id="referral-details" className={cn("grid bg-white transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden" inert={!open}>
          <div className="space-y-4 p-4 text-sm text-slate-700 sm:p-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-accent-700">{justJoined ? "Welcome aboard" : "In on the ground floor"}</div>
              <p className="mt-1">
                {brandName} is just getting started, and the elevator is going up. We&apos;re opening market by market, adding states and professions as we grow, and the people who join early are first in line as each door opens. There&apos;s a lot ahead, and we&apos;re glad you&apos;re on board for the ride.
              </p>
            </div>
            <p>
              Know a {kind === "clinic" ? "clinic owner or a provider" : "colleague, classmate or clinic"} who should be here too? Share your link: when they complete their first shift, you get <b>{you}</b>
              {kind === "clinic" ? " off your next shift" : " with your next pay"} and they get a <b>{friend}</b> bonus. No limit.
            </p>
            <SharePanel link={link} subject={`Join me on ${brandName}`} message={message} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span>
                {joined ? `${joined} joined with your link` : "No one has joined with your link yet"}
                {earned ? <> · <b className="text-emerald-700">{earned} earned</b></> : null}
              </span>
              <span className="flex gap-3">
                <a href={referHref} className="font-medium text-brand-700 hover:underline">QR code and your referrals →</a>
                <a href="/referral-terms" className="hover:underline">Terms</a>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
