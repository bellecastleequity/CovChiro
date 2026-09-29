import { brand } from "@cm/config";
import { getSettings } from "@cm/services";

export const metadata = { title: "FAQ" };

export default async function Faq() {
  const b = brand();
  const s = await getSettings();
  const qa: [string, string][] = [
    ["How do you verify providers?", "Every license is checked against the state board for that profession and state, and re-verified on a schedule. Malpractice certificates and NPI numbers are verified too. Providers can only see and apply to shifts where their license qualifies through the end of the shift."],
    ["Can a provider licensed in another state cover my clinic?", "No. A provider needs a verified license for your profession in your clinic's state. Where they live doesn't matter."],
    ["Who sets the price?", `${b.name} sets prices by region and shift length so they're consistent and fair. Mileage is passed through to the provider at cost.`],
    ["What if I need to cancel?", `Cancel ${s["payments.clinicFreeCancelHours"]} or more hours before the shift for a full deposit refund. Later cancellations forfeit the deposit, part of which compensates the provider.`],
    ["What if the provider cancels?", "You're refunded in full and we immediately reopen the shift to other eligible providers."],
    ["Do you handle patient records?", "No. The platform never collects patient information. Please don't include patient details in messages or notes."],
    ["How do providers get paid?", `Through Stripe, directly to their bank, about ${s["payments.payoutHoldHours"]} hours after the shift completes.`],
  ];
  return (
    <div className="container-page max-w-3xl py-16">
      <h1 className="text-4xl font-semibold">Frequently asked questions</h1>
      <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200">
        {qa.map(([q, a]) => (
          <details key={q} className="group p-5">
            <summary className="cursor-pointer list-none font-medium marker:hidden">
              <span className="flex items-center justify-between gap-4">
                {q}
                <span className="text-slate-400 transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 text-sm text-slate-600">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
