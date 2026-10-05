"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { FormGuard, guardFields } from "./form-guard";

type Kind = "popup" | "landing" | "waitlist" | "contact";

export function LeadForm({
  source,
  audience = "CLINIC",
  campaign,
  professionCode,
  states,
  professions,
  askAudience,
  cta = "Get my code",
  compact,
}: {
  source: Kind;
  audience?: "CLINIC" | "PROVIDER";
  campaign?: string;
  professionCode?: string;
  states?: { code: string; name: string }[];
  /** Waitlist: let the visitor pick a profession (blank = any). */
  professions?: { code: string; name: string }[];
  /** Waitlist: ask "I'm a clinic / I'm a provider". */
  askAudience?: boolean;
  cta?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string | null; offer: string | null; expiresAt: string | null; alreadyOpen?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams(location.search);
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      organization: fd.get("organization") || undefined,
      phone: fd.get("phone") || undefined,
      state: fd.get("state") || undefined,
      message: fd.get("message") || undefined,
      professionCode: professionCode ?? (fd.get("professionCode") || undefined),
      source,
      audience: askAudience ? fd.get("audience") || audience : audience,
      campaign,
      landingPath: location.pathname,
      utm: { source: params.get("utm_source") ?? undefined, medium: params.get("utm_medium") ?? undefined, campaign: params.get("utm_campaign") ?? undefined },
      ...guardFields(fd),
    };
    try {
      const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "Something went wrong.");
      else setDone({ code: j.code, offer: j.offer, expiresAt: j.expiresAt, alreadyOpen: !!j.alreadyOpen });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="size-5" />
          {done.code ? "Here's your code" : done.alreadyOpen ? "Good news: we're already open there" : source === "waitlist" ? "You're on the list" : "Thanks — we'll be in touch"}
        </div>
        {done.code ? (
          <>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(done.code!);
                setCopied(true);
              }}
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-emerald-300 bg-white px-4 py-3 font-mono text-lg font-semibold tracking-wider"
            >
              {done.code}
              <span className="flex items-center gap-1 text-xs font-sans font-medium text-emerald-700">
                <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
              </span>
            </button>
            <p className="mt-2 text-sm">
              {done.offer} your first coverage shift{done.expiresAt ? `, valid until ${new Date(done.expiresAt).toLocaleDateString("en-US")}` : ""}. We've emailed it to you too.
            </p>
            <a href={`/signup?role=clinic&code=${encodeURIComponent(done.code)}`} className={buttonClass("primary", "md", "mt-4 w-full")}>
              Create your clinic account
            </a>
          </>
        ) : (
          <p className="mt-2 text-sm">{done.alreadyOpen ? "We've emailed you a link to get started." : source === "waitlist" ? "We'll email you the day we open in your area." : "Check your inbox for a confirmation."}</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={compact ? "space-y-3" : "space-y-4"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input className="req-mark" name="name" required placeholder="Your name" autoComplete="name" aria-label="Your name" />
        <Input className="req-mark" name="email" type="email" required placeholder="Email" autoComplete="email" aria-label="Email" />
      </div>
      {source === "contact" || source === "waitlist" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {source === "contact" ? <Input name="organization" placeholder="Clinic or practice (optional)" aria-label="Organization" /> : null}
          {askAudience ? (
            <Select name="audience" defaultValue="CLINIC" aria-label="I'm a">
              <option value="CLINIC">I&apos;m a clinic</option>
              <option value="PROVIDER">I&apos;m a provider</option>
            </Select>
          ) : null}
          {professions ? (
            <Select name="professionCode" defaultValue="" aria-label="Profession">
              <option value="">Any profession</option>
              {professions.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </Select>
          ) : null}
          {states ? (
            <Select name="state" defaultValue="" aria-label="State" required={source === "waitlist"}>
              <option value="" disabled>
                Your state
              </option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      ) : null}
      {source === "contact" ? <Textarea className="req-mark" name="message" required placeholder="How can we help?" aria-label="Message" /> : null}
      <FormGuard />
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      <button type="submit" disabled={busy} className={buttonClass("primary", "lg", "w-full")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {cta}
      </button>
      <p className="text-center text-xs text-slate-500">No spam. Unsubscribe anytime.</p>
    </form>
  );
}
