import { brand } from "@cm/config";
import { AskForm } from "@/components/site/ask-form";
import { LeadForm } from "@/components/site/lead-form";

export const metadata = { title: "Contact", description: "Questions about coverage, pricing or joining as a provider? Ask us anything.", alternates: { canonical: "/contact" } };

export default function Contact() {
  const b = brand();
  return (
    <div className="container-page grid max-w-5xl gap-10 py-16 lg:grid-cols-2">
      <div>
        <h1 className="text-4xl font-semibold">Talk to us</h1>
        <p className="mt-4 text-slate-600">Questions about coverage, pricing, or joining as a provider? Send a note and we'll reply within one business day.</p>
        <p className="mt-6 text-sm text-slate-500">
          Or email <a className="font-medium text-brand-700" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>
        </p>
      </div>
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 p-6 shadow-card">
          <h2 className="mb-1 font-semibold">Quick question?</h2>
          <p className="mb-4 text-sm text-slate-500">Get an instant answer from our published policies, or a person will reply by email.</p>
          <AskForm />
        </div>
        <div className="rounded-2xl border border-slate-200 p-6 shadow-card">
          <LeadForm source="contact" cta="Send message" />
        </div>
      </div>
    </div>
  );
}
