import { faqLd } from "@cm/core";
import { getSettings, siteFaq } from "@cm/services";
import { JsonLd } from "@/components/site/json-ld";

export const metadata = { title: "FAQ", description: "Answers about booking coverage, provider verification, pricing, payment and cancellations.", alternates: { canonical: "/faq" } };

export default async function Faq() {
  const qa = siteFaq(await getSettings());
  return (
    <div className="container-page max-w-3xl py-16">
      <JsonLd data={faqLd(qa)} />
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
