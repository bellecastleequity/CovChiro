"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

export function MobileMenu({ nav, signedIn, home }: { nav: { href: string; label: string }[]; signedIn: boolean; home: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-10 place-items-center rounded-lg text-slate-700 hover:bg-slate-100">
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-16 border-b border-slate-200 bg-white px-4 pb-5 pt-2 shadow-lg">
          <nav className="flex flex-col">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-slate-700 hover:bg-slate-50">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {signedIn ? (
              <Link href={home} className="col-span-2 rounded-xl bg-brand-600 px-4 py-2.5 text-center text-sm font-medium text-white">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-xl border border-slate-300 px-4 py-2.5 text-center text-sm font-medium">
                  Sign in
                </Link>
                <Link href="/signup" className="rounded-xl bg-brand-600 px-4 py-2.5 text-center text-sm font-medium text-white">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
