import { Lock } from "lucide-react";
import { feedback } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Feedback" };
export const dynamic = "force-dynamic";

export default async function Feedback() {
  const { actor } = await requireActor("provider");
  const rows = await feedback.myFeedback(actor);
  return (
    <>
      <PageHeader
        title="Private feedback"
        description={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" />Notes clinics left just for you. Nobody else sees them, and they never affect your ratings, badges, profile or the shifts you're offered.</span>}
      />
      {rows.length ? (
        <div className="space-y-4">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{r.clinic}</span>
                  <span className="flex items-center gap-2 text-slate-500">
                    {r.shiftDate ? `Shift on ${dateLabel(r.shiftDate, r.timeZone, { month: "short", day: "numeric", year: "numeric" })}` : null}
                    {r.isNew ? <Badge tone="brand">New</Badge> : null}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-line text-slate-700">{r.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Empty title="No feedback yet">After a shift, clinics can leave you a private note. It'll show up here.</Empty>
      )}
    </>
  );
}
