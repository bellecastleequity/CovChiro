import Link from "next/link";
import { brand } from "@cm/config";
import { readingMinutes } from "@cm/core";
import { blog } from "@cm/services";
import { cn } from "@/lib/cn";
import { dateLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const b = brand();
  return {
    title: "Blog",
    description: `Practical guides on clinic coverage, covering doctors and per diem work from ${b.name}.`,
    alternates: { canonical: "/blog", types: { "application/rss+xml": "/blog/rss.xml" } },
  };
}

const TABS = [
  { key: "", label: "All" },
  { key: "clinic", label: "For clinics" },
  { key: "provider", label: "For providers" },
];

export default async function BlogIndex({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const f = (await searchParams).for ?? "";
  const tab = TABS.some((t) => t.key === f) ? f : "";
  const posts = await blog.publicPosts({ audience: tab || undefined });
  return (
    <div className="container-page py-16">
      <div className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">Blog</div>
        <h1 className="mt-2 text-4xl font-semibold">Guides for clinics and providers</h1>
        <p className="mt-4 text-lg text-slate-600">Practical answers about coverage days, covering doctors, credentialing and per diem work.</p>
      </div>
      <div className="mt-8 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key ? `/blog?for=${t.key}` : "/blog"}
            role="tab"
            aria-selected={tab === t.key}
            className={cn("rounded-full px-4 py-1.5 text-sm font-medium ring-1", tab === t.key ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {posts.length ? (
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link key={p.id} href={`/blog/${p.slug}`} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition hover:border-brand-200">
              <div className="text-xs font-semibold uppercase tracking-wider text-accent-700">{p.audience === "CLINIC" ? "For clinics" : p.audience === "PROVIDER" ? "For providers" : "Clinics & providers"}</div>
              <h2 className="mt-2 text-lg font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{p.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{p.description}</p>
              <div className="mt-4 text-xs text-slate-500">
                {p.publishedAt ? dateLabel(p.publishedAt, "America/New_York", { month: "long", day: "numeric", year: "numeric" }) : null} · {readingMinutes(p.body)} min read
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-10 text-slate-500">New articles are on the way.</p>
      )}
    </div>
  );
}
