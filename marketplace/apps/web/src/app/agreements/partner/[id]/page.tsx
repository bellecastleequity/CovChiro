import Link from "next/link";
import { notFound } from "next/navigation";
import { partners } from "@cm/services";
import { AgreementDocument } from "@/components/agreements/document";
import { PrintButton } from "@/components/agreements/print-button";
import { Alert } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Signed Partner Addendum" };
export const dynamic = "force-dynamic";

const at = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "long" }) : "—");

/** A signed Clinic Partner Addendum with its signature certificate (that clinic's members and admins). */
export default async function SignedPartnerAddendum({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("any");
  const { id } = await params;
  const r = await partners.signedPartnerAddendum(actor, id).catch(() => null);
  if (!r) notFound();
  const { p, doc, intact } = r;
  const back = actor.role === "PLATFORM_ADMIN" ? `/admin/clinics/${p.clinicOrgId}` : "/clinic/partner";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back} className="text-sm font-medium text-brand-700">← Back</Link>
        <PrintButton />
      </div>
      {!intact ? <Alert tone="error" className="mb-5" title="Integrity check failed">The stored text no longer matches its fingerprint. Contact support.</Alert> : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <AgreementDocument doc={doc} />
        <div className="mt-8 border-t border-slate-200 pt-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signature</div>
          <div className="mt-2 font-serif text-3xl italic text-slate-900">{p.typedSignature}</div>
          <div className="text-sm text-slate-600">{p.typedSignature}{p.signerTitle ? `, ${p.signerTitle}` : ""} · {at(p.startsAt)}</div>
        </div>
      </div>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm sm:p-6 print:mt-10 print:break-before-page">
        <h2 className="font-semibold text-slate-900">Signature certificate</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[180px_1fr]">
          <dt className="text-slate-500">Document</dt><dd>{doc.title} · version {doc.version}</dd>
          <dt className="text-slate-500">Reference</dt><dd className="font-mono text-xs">{p.id}</dd>
          <dt className="text-slate-500">Signer</dt><dd>{p.typedSignature}{p.signerTitle ? ` (${p.signerTitle})` : ""} · {p.signerEmail}</dd>
          <dt className="text-slate-500">Offered</dt><dd>{at(p.offeredAt)}</dd>
          <dt className="text-slate-500">Consented to e-sign</dt><dd>{at(p.consentAt)}</dd>
          <dt className="text-slate-500">Signed</dt><dd>{at(p.startsAt)}</dd>
          <dt className="text-slate-500">IP address</dt><dd className="font-mono text-xs">{p.signerIp ?? "—"}</dd>
          <dt className="text-slate-500">Device</dt><dd className="break-all text-xs">{p.signerAgent ?? "—"}</dd>
          <dt className="text-slate-500">Fingerprint (SHA-256)</dt><dd className="break-all font-mono text-xs">{p.documentHash}</dd>
        </dl>
      </div>
    </div>
  );
}
