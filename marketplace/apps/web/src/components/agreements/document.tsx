import type { AgreementDoc } from "@cm/services";

/** An agreement rendered for reading, signing or printing. */
export function AgreementDocument({ doc }: { doc: AgreementDoc }) {
  return (
    <article className="space-y-5 text-[15px] leading-relaxed text-slate-700">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">{doc.title}</h1>
        <div className="text-sm text-slate-500">Version {doc.version}</div>
      </header>
      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 print:bg-transparent print:p-0">
        {doc.parties.map((p) => (
          <div key={p.label}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.label}</div>
            {p.lines.map((l) => <div key={l}>{l}</div>)}
          </div>
        ))}
      </div>
      {doc.sections.map((s) => (
        <section key={s.heading} className="break-inside-avoid-page">
          <h2 className="mb-1.5 font-semibold text-slate-900">{s.heading}</h2>
          <div className="space-y-2">{s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
        </section>
      ))}
    </article>
  );
}
