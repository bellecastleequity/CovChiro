import Link from "next/link";
import { notFound } from "next/navigation";
import { signedAgreement } from "@cm/services";
import { AgreementDocument } from "@/components/agreements/document";
import { PrintButton } from "@/components/agreements/print-button";
import { Alert } from "@/components/ui/misc";
import { homeFor, requireActor } from "@/lib/session";

export const metadata = { title: "Signed agreement" };
export const dynamic = "force-dynamic";

const at = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "long" }) : "—");

export default async function Signed({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { actor, user } = await requireActor("any");
  const { id } = await params;
  const sp = await searchParams;
  const r = await signedAgreement(actor, id).catch(() => null);
  if (!r) notFound();
  const { sig, signer, doc, intact } = r;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={homeFor(actor.role)} className="text-sm font-medium text-brand-700">← Back to your dashboard</Link>
        <PrintButton />
      </div>
      {sp.new ? <Alert tone="success" className="mb-5 print:hidden" title="Signed — thank you">A copy has been emailed to you. You can come back to this page any time from your settings.</Alert> : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        {doc ? <AgreementDocument doc={doc} /> : <p className="text-sm text-slate-600">Version {sig.version}, signed through {sig.provider === "dropbox-sign" ? "Dropbox Sign" : "the test signing page"}. The full text is held by that service.</p>}
        {sig.typedSignature ? (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signature</div>
            <div className="mt-2 font-serif text-3xl italic text-slate-900">{sig.typedSignature}</div>
            <div className="text-sm text-slate-600">{sig.typedSignature}{sig.signerTitle ? `, ${sig.signerTitle}` : ""} · {at(sig.signedAt)}</div>
          </div>
        ) : null}
      </div>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm sm:p-6 print:mt-10 print:break-before-page">
        <h2 className="font-semibold text-slate-900">Signature certificate</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[180px_1fr]">
          <dt className="text-slate-500">Agreement</dt><dd>{doc?.title ?? "Platform agreement"} · version {sig.version}</dd>
          <dt className="text-slate-500">Reference</dt><dd className="font-mono text-xs">{sig.id}</dd>
          <dt className="text-slate-500">Signer account</dt><dd>{signer?.name} · {sig.signerEmail ?? signer?.email}</dd>
          {sig.typedSignature ? (<><dt className="text-slate-500">Typed signature</dt><dd>{sig.typedSignature}{sig.signerTitle ? ` (${sig.signerTitle})` : ""}</dd></>) : null}
          <dt className="text-slate-500">Sent</dt><dd>{at(sig.createdAt)}</dd>
          <dt className="text-slate-500">First viewed</dt><dd>{at(sig.viewedAt)}</dd>
          <dt className="text-slate-500">Consented to e-sign</dt><dd>{at(sig.consentAt)}</dd>
          <dt className="text-slate-500">Signed</dt><dd>{at(sig.signedAt)}</dd>
          <dt className="text-slate-500">IP address</dt><dd className="font-mono text-xs">{sig.signerIp ?? "—"}</dd>
          <dt className="text-slate-500">Device</dt><dd className="break-all text-xs">{sig.signerAgent ?? "—"}</dd>
          <dt className="text-slate-500">Document SHA-256</dt><dd className="break-all font-mono text-xs">{sig.documentHash ?? "—"}</dd>
          <dt className="text-slate-500">Integrity</dt><dd>{sig.documentHash ? (intact ? "✓ The stored text matches its fingerprint" : "✗ The stored text does not match its fingerprint") : "—"}</dd>
        </dl>
      </div>
    </div>
  );
}
