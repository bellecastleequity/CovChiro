import { getSettings, siteFaq } from "@cm/services";
import { faqLd, JsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "FAQ: fill-in coverage for clinics and providers",
  description: "How provider licenses are verified, who sets the price, cancellations, payouts and patient privacy: answers for clinics and providers.",
  path: "/faq",
});

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
