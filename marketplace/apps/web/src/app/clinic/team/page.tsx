import { clinicProfile } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { inviteStaffAction } from "../actions";

export const metadata = { title: "Team" };

export default async function Team() {
  const { actor } = await requireActor("clinic");
  const { org } = await clinicProfile(actor);
  return (
    <>
      <PageHeader title="Team" description="Staff can post shifts, choose providers, message and rate. Only the owner can change billing." />
      <Card>
        <div className="divide-y divide-slate-100">
          {org.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div><div className="font-medium">{m.user.name}</div><div className="text-slate-500">{m.user.email}</div></div>
              <div className="text-right"><Badge tone={m.role === "CLINIC_OWNER" ? "brand" : "gray"}>{m.role === "CLINIC_OWNER" ? "Owner" : "Staff"}</Badge><div className="mt-1 text-xs text-slate-400">{m.user.lastLoginAt ? `Last seen ${dateTimeLabel(m.user.lastLoginAt)}` : "Invited"}</div></div>
            </div>
          ))}
        </div>
      </Card>
      {actor.role === "CLINIC_OWNER" ? (
        <Card className="mt-6">
          <CardHeader title="Invite a team member" />
          <CardBody>
            <ActionForm action={inviteStaffAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
              <Input name="name" placeholder="Name" required />
              <Input name="email" type="email" placeholder="Email" required />
              <SubmitButton>Send invite</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
