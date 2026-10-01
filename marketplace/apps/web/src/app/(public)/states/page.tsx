import { US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Where we're available", description: "States and professions where clinics can book licensed fill-in coverage today, and where we're opening next.", path: "/states" });
export const dynamic = "force-dynamic";

export default async function States() {
  const [pairs, professions] = await Promise.all([
    prisma.professionStateConfig.findMany({ where: { enabled: true } }),
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const byState = new Map<string, string[]>();
  for (const p of pairs) byState.set(p.state, [...(byState.get(p.state) ?? []), p.professionCode]);
  return (
    <div className="container-page py-16">
      <h1 className="text-4xl font-semibold">Where we're available</h1>
      <p className="mt-3 max-w-2xl text-slate-600">We open state by state and profession by profession, after legal review and license verification are in place.</p>
      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(US_STATES).map(([code, name]) => {
          const live = byState.get(code);
          return (
            <div key={code} className={`rounded-xl border p-3 text-sm ${live ? "border-brand-300 bg-brand-50" : "border-slate-200 text-slate-400"}`}>
              <div className="font-semibold">{code}</div>
              <div className="truncate text-xs">{name}</div>
              {live ? <div className="mt-1 text-xs font-medium text-brand-700">{live.map((c) => professions.find((p) => p.code === c)?.credentialSuffix ?? c).join(", ")}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
