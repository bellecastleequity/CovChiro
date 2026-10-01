import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { brand, env } from "@cm/config";
import { readingMinutes } from "@cm/core";
import { blog } from "@cm/services";
import { Markdown, TableOfContents } from "@/components/blog/markdown";
import { LinkButton } from "@/components/ui/button";
import { dateLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await blog.publicPost((await params).slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.description,
    keywords: p.keywords,
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: { type: "article", title: p.title, description: p.description, url: `/blog/${p.slug}`, publishedTime: p.publishedAt?.toISOString(), modifiedTime: p.updatedAt.toISOString() },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await blog.publicPost((await params).slug);
  if (!p) notFound();
  const b = brand();
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const related = await blog.relatedPosts(p);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.title,
    description: p.description,
    datePublished: p.publishedAt?.toISOString(),
    dateModified: p.updatedAt.toISOString(),
    mainEntityOfPage: `${base}/blog/${p.slug}`,
    keywords: p.keywords.join(", "),
    author: { "@type": "Organization", name: p.authorName ?? b.name },
    publisher: { "@type": "Organization", name: b.name, logo: { "@type": "ImageObject", url: `${base}/brand/logo.png` } },
  };
  const forClinics = p.audience !== "PROVIDER";
  return (
    <article className="container-page py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" /> All articles
      </Link>
      <header className="mt-6 max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-accent-700">{p.audience === "CLINIC" ? "For clinics" : p.audience === "PROVIDER" ? "For providers" : "Clinics & providers"}</div>
        <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">{p.title}</h1>
        <p className="mt-4 text-lg text-slate-600">{p.description}</p>
        <div className="mt-4 text-sm text-slate-500">
          {p.authorName ?? `The ${b.name} team`} · {p.publishedAt ? dateLabel(p.publishedAt, "America/New_York", { month: "long", day: "numeric", year: "numeric" }) : null} · {readingMinutes(p.body)} min read
        </div>
      </header>
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="max-w-3xl">
          <Markdown source={p.body} />
          <div className="mt-12 rounded-2xl bg-brand-600 p-6 text-white sm:p-8">
            <h2 className="text-xl font-semibold">{forClinics ? "Need coverage for your clinic?" : "Looking for coverage shifts?"}</h2>
            <p className="mt-2 text-brand-100">
              {forClinics ? "Post the day and see verified, licensed providers matched to your clinic. Pricing is shown before you post." : "Get verified once and see shifts you're licensed for, with your pay and mileage up front."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <LinkButton href={forClinics ? "/signup?role=clinic" : "/signup?role=provider"} variant="secondary">{forClinics ? "Create a clinic account" : "Create your profile"}</LinkButton>
              <LinkButton href={forClinics ? "/for-clinics" : "/for-providers"} variant="outline">{forClinics ? "See pricing" : "Why providers join"}</LinkButton>
            </div>
          </div>
        </div>
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <TableOfContents source={p.body} />
          {related.length ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">More articles</div>
              <ul className="mt-3 space-y-3">
                {related.map((r) => (
                  <li key={r.id}><Link href={`/blog/${r.slug}`} className="text-sm font-medium text-slate-800 hover:text-brand-700">{r.title}</Link></li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
