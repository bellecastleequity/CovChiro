import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CirclePlay } from "lucide-react";
import { brand, env } from "@cm/config";
import { readingMinutes } from "@cm/core";
import { blog } from "@cm/services";
import { Markdown, TableOfContents } from "@/components/blog/markdown";
import { YouTubeEmbed } from "@/components/blog/youtube";
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
  const [related, videos] = await Promise.all([blog.relatedPosts(p), blog.postVideos(p)]);
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
          {videos.embed ? <YouTubeEmbed id={videos.embed.id} title={videos.embed.title} className="mb-10" /> : null}
          <Markdown source={p.body} />
          {videos.suggested ? (
            <section className="mt-12" aria-labelledby="watch-next">
              <h2 id="watch-next" className="text-xl font-semibold">Watch next</h2>
              <p className="mt-1 text-sm text-slate-600">{videos.suggested.title}</p>
              <YouTubeEmbed id={videos.suggested.id} title={videos.suggested.title} className="mt-4" />
              {videos.channelUrl ? (
                <a href={videos.channelUrl} target="_blank" rel="noopener" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800">
                  <CirclePlay className="size-4" /> More videos on our YouTube channel
                </a>
              ) : null}
            </section>
          ) : null}
          {related.length ? (
            <section className="mt-12" aria-labelledby="keep-reading">
              <h2 id="keep-reading" className="text-xl font-semibold">Keep reading</h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/blog/${r.slug}`} className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm">
                      <span className="text-xs font-semibold uppercase tracking-wider text-accent-700">{r.audience === "CLINIC" ? "For clinics" : r.audience === "PROVIDER" ? "For providers" : "Clinics & providers"}</span>
                      <span className="mt-2 font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{r.title}</span>
                      <span className="mt-2 line-clamp-3 text-sm text-slate-600">{r.description}</span>
                      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-brand-700">Read <ArrowRight className="size-4" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
        </aside>
      </div>
    </article>
  );
}
