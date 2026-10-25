import Link from "next/link";
import { ShrinkPhotos } from "@/components/admin/shrink-photos";
import { photoSrc } from "@/lib/photo";
import { PROVIDER_GROUPS } from "@cm/core";
import { adminlists } from "@cm/services";
import { CountChips, FilterForm, ListSummary, stateLabel, type ListParams } from "@/components/admin/list-filters";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { pct } from "@/lib/format";
import { requireActor } from "@/lib/session";

/** "Dr. Adriana Bedford Blaise" → "AB" (no headshot yet). */
const initials = (name: string) =>
  name.replace(/^dr\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

const groupLabel = Object.fromEntries(PROVIDER_GROUPS.map((g) => [g.key, g.label]));
const groupTone = { ready: "green", break: "amber", inactive: "amber", paused: "amber", onboarding: "blue", suspended: "red", deactivated: "gray" } as const;

export default async function Providers({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { actor } = await requireActor("admin");
  const sp = await searchParams;
  const params: ListParams = { q: sp.q, group: sp.group, state: sp.state, profession: sp.profession, all: sp.all };
  const list = await adminlists.providerList(actor, { ...params, all: !!sp.all });
  const rows = list.rows;
  const path = "/admin/providers";
  return (
    <>
      <PageHeader title="Providers" description={`${list.total.toLocaleString()} providers · ${list.groups.find((g) => g.key === "ready")!.count.toLocaleString()} ready for shifts`} />
      <div className="mb-4"><ShrinkPhotos /></div>
      <div className="mb-4 space-y-3">
        <CountChips path={path} params={params} name="group" total={list.groupTotal}
          options={[...list.groups.map((g) => ({ value: g.key, label: g.label, count: g.count })), { value: "student", label: "Students", count: list.students }]} />
        <FilterForm path={path} params={params} placeholder="Name, email or NPI" keep={["group"]}
          selects={[
            { name: "state", label: "State (license or home)", options: list.states.map((s) => ({ value: s.key, label: `${stateLabel(s.key)} · ${s.count}` })) },
            ...(list.professions.length > 1 ? [{ name: "profession", label: "Profession", options: list.professions.map((x) => ({ value: x.key, label: `${x.key} · ${x.count}` })) }] : []),
          ]} />
        <ListSummary path={path} params={params} shown={rows.length} matched={list.matched} total={list.total} noun="providers" />
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Provider</Th><Th>Professions</Th><Th>Verified licenses</Th><Th>Completed</Th><Th>Reliability</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.length ? null : <tr><Td colSpan={6} className="py-8 text-center text-slate-500">No providers match these filters.</Td></tr>}
            {rows.map((p) => {
              const s = p.stats;
              const rel = s ? (s.completedShifts + 5) / (s.completedShifts + 5 + 2 * s.lateCancels + 5 * s.noShows) : 1;
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <div className="flex items-center gap-3">
                      {p.photoUrl ? (
                        <img src={photoSrc(p.photoUrl)} alt="" loading="lazy" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
                      ) : (
                        <div aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{initials(p.displayName)}</div>
                      )}
                      <div className="min-w-0">
                        <Link href={`/admin/providers/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.displayName}</Link>
                        <div className="text-xs text-slate-500">{p.user.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>{p.professions.map((x) => x.professionCode).join(", ")}</Td>
                  <Td>{p.licenses.map((l) => `${l.professionCode}-${l.state}`).join(", ") || "—"}</Td>
                  <Td>{s?.completedShifts ?? 0}</Td>
                  <Td>{pct(rel)}</Td>
                  <Td><div className="flex flex-wrap gap-1"><Badge tone={groupTone[p.group]}>{groupLabel[p.group]}</Badge>{p.preLicensure ? <Badge tone="blue">Student</Badge> : null}</div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
