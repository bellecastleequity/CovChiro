import Link from "next/link";
import { inlineText, parseMarkdown, type Block, type Inline } from "@cm/core";

/** Renders the blog's safe Markdown subset as React elements (never raw HTML). */
export function Markdown({ source }: { source: string }) {
  return <div className="blog-prose">{parseMarkdown(source).map((b, i) => <BlockEl key={i} b={b} />)}</div>;
}

function BlockEl({ b }: { b: Block }) {
  switch (b.t) {
    case "h2":
      return <h2 id={b.id} className="mb-3 mt-10 scroll-mt-20 text-2xl font-semibold text-slate-900"><Inlines c={b.c} /></h2>;
    case "h3":
      return <h3 id={b.id} className="mb-2 mt-7 scroll-mt-20 text-lg font-semibold text-slate-900"><Inlines c={b.c} /></h3>;
    case "p":
      return <p className="my-4 text-[17px] leading-8 text-slate-700"><Inlines c={b.c} /></p>;
    case "quote":
      return <blockquote className="my-6 border-l-4 border-accent-500 bg-accent-50/50 py-2 pl-5 pr-3 text-[17px] leading-8 text-slate-700"><Inlines c={b.c} /></blockquote>;
    case "ul":
    case "ol": {
      const Tag = b.t;
      return (
        <Tag className={`my-4 space-y-2 pl-6 text-[17px] leading-8 text-slate-700 ${b.t === "ul" ? "list-disc marker:text-accent-600" : "list-decimal marker:font-semibold marker:text-brand-600"}`}>
          {b.items.map((it, i) => <li key={i} className="pl-1"><Inlines c={it} /></li>)}
        </Tag>
      );
    }
  }
}

function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) => {
        if (x.t === "text") return x.v;
        if (x.t === "b") return <strong key={i} className="font-semibold text-slate-900"><Inlines c={x.c} /></strong>;
        if (x.t === "i") return <em key={i}><Inlines c={x.c} /></em>;
        const cls = "font-medium text-brand-700 underline decoration-accent-400 underline-offset-2 hover:text-brand-900";
        return x.href.startsWith("/") || x.href.startsWith("#") ? (
          <Link key={i} href={x.href} className={cls}><Inlines c={x.c} /></Link>
        ) : (
          <a key={i} href={x.href} className={cls} target="_blank" rel="noopener noreferrer nofollow"><Inlines c={x.c} /></a>
        );
      })}
    </>
  );
}

/** "On this page" links built from the post's ## headings. */
export function TableOfContents({ source }: { source: string }) {
  const hs = parseMarkdown(source).filter((b): b is Extract<Block, { id: string }> => b.t === "h2");
  if (hs.length < 3) return null;
  return (
    <nav aria-label="On this page" className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">On this page</div>
      <ol className="mt-3 space-y-2 text-sm">
        {hs.map((h) => (
          <li key={h.id}><a href={`#${h.id}`} className="text-slate-700 hover:text-brand-700">{inlineText(h.c)}</a></li>
        ))}
      </ol>
    </nav>
  );
}
