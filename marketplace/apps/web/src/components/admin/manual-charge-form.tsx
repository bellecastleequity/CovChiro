"use client";

import { useCallback, useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/form";

type Clinic = { id: string; label: string };
type Option = { value: string; label: string };

/** Same parsing as the server (lib/action dollarsToCents): "$1,234.5" → 123450. */
function toCents(v: string): number | null {
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Admin manual charge. The button always shows the exact amount ("Charge $0.51"),
 * and the confirm box repeats clinic, payment method, type, amount and description.
 */
export function ManualChargeForm({ action, clinics, types, minCents = 50 }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; clinics: Clinic[]; types: Option[]; minCents?: number }) {
  const [clinicId, setClinicId] = useState("");
  const [type, setType] = useState(types[0]?.value ?? "");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  // Stable so ActionForm's effect fires once per result, not on every keystroke.
  const reset = useCallback((s: ActionState) => {
    if (s?.ok) { setClinicId(""); setAmount(""); setDesc(""); }
  }, []);
  const cents = toCents(amount);
  const valid = cents !== null && cents >= minCents;
  const clinic = clinics.find((c) => c.id === clinicId);
  const typeLabel = types.find((t) => t.value === type)?.label ?? type;
  const confirm = valid && clinic
    ? `Charge ${usd(cents)}?\n\nClinic: ${clinic.label}\nType: ${typeLabel}\nAmount: ${usd(cents)}\nDescription: ${desc || "—"}\n\nThis charges the clinic's saved payment method now.`
    : undefined;

  return (
    <ActionForm
      action={action}
      className="grid gap-2 sm:grid-cols-5"
      confirm={confirm}
      onDone={reset}
    >
      <Select name="clinicOrgId" required className="sm:col-span-2" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
        <option value="" disabled>Choose a clinic…</option>
        {clinics.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </Select>
      <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
        {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      <Input name="amount" inputMode="decimal" placeholder={`$ amount (min ${usd(minCents)})`} required value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input name="description" placeholder="Description" required value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-5">
        <SubmitButton size="sm" variant="outline" disabled={!valid || !clinic}>{valid ? `Charge ${usd(cents)}` : "Charge"}</SubmitButton>
        <span className="text-sm text-slate-600">
          {amount && !valid ? <span className="text-red-700">Enter at least {usd(minCents)}.</span>
            : valid ? <>Will charge <strong className="tabular-nums">{usd(cents)}</strong>{clinic ? <> to {clinic.label}</> : null}. You'll confirm before anything is charged.</>
            : null}
        </span>
      </div>
    </ActionForm>
  );
}
