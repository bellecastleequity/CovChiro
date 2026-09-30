import Link from "next/link";
import { Ban, Heart } from "lucide-react";
import { clinicRelationships } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { favoriteAction, unblockAction } from "../actions";

export const metadata = { title: "My providers" };
export const dynamic = "force-dynamic";

export default async function MyProviders() {
  const { actor } = await requireActor("clinic");
  const { favorites, blocked } = await clinicRelationships(actor);
  const who = (p: { id: string; displayName: string; homeCity: string | null; homeState: string | null }) => (
    <div>
      <Link href={`/clinic/providers/${p.id}`} className="font-medium hover:text-brand-700">{p.displayName}</Link>
      <div className="text-xs text-slate-500">{[p.homeCity, p.homeState].filter(Boolean).join(", ")}</div>
    </div>
  );
  return (
    <>
      <PageHeader title="My providers" description="Favorites get the first look at your new shifts and rank higher in your candidate list. Blocked providers are never offered your shifts." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Heart className="size-4 fill-red-500 text-red-500" />Favorites ({favorites.length})</span>} description="Add a favorite from a completed shift or the provider's profile." />
          <CardBody className="divide-y divide-slate-100 p-0">
            {favorites.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                {who(p)}
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {p.shiftsTogether} shift{p.shiftsTogether === 1 ? "" : "s"} together
                  <ActionForm action={favoriteAction} successMessage={false}>
                    <input type="hidden" name="providerId" value={p.id} />
                    <input type="hidden" name="on" value="0" />
                    <SubmitButton size="sm" variant="ghost">Remove</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            ))}
            {!favorites.length ? <p className="px-5 py-4 text-sm text-slate-500">No favorites yet.</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Ban className="size-4 text-slate-500" />Blocked ({blocked.length})</span>} description="Blocked from future bookings. Only you see this list." />
          <CardBody className="divide-y divide-slate-100 p-0">
            {blocked.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  {who(p)}
                  <div className="text-xs text-slate-500">Since {dateLabel(p.since, "America/New_York", { month: "short", day: "numeric", year: "numeric" })}{p.reason ? ` · ${p.reason}` : ""}</div>
                </div>
                <ActionForm action={unblockAction} confirm={`Unblock ${p.displayName}? They can be offered your shifts again.`} successMessage={false}>
                  <input type="hidden" name="providerId" value={p.id} />
                  <SubmitButton size="sm" variant="ghost">Unblock</SubmitButton>
                </ActionForm>
              </div>
            ))}
            {!blocked.length ? <p className="px-5 py-4 text-sm text-slate-500">Nobody blocked.</p> : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
