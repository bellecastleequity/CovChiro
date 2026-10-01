import { accounts } from "@cm/services";
import { deleteAccountAction, moderateAccountAction } from "@/app/admin/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";

/** Suspend / ban / reinstate / delete for a provider or clinic (admin detail pages). */
export async function AccountModeration({ kind, id, status }: { kind: "provider" | "clinic"; id: string; status: string }) {
  const impact = await accounts.accountImpact(kind, id);
  const who = kind === "provider" ? "provider" : "clinic";
  const restricted = status === "SUSPENDED" || status === "DEACTIVATED" || impact.banned || impact.signInDisabled;
  const upcomingLabel = kind === "provider" ? `${impact.upcoming} upcoming confirmed shift${impact.upcoming === 1 ? "" : "s"}` : `${impact.upcoming} upcoming posted shift${impact.upcoming === 1 ? "" : "s"}`;
  return (
    <Card>
      <CardHeader
        title={<>Suspend, ban or delete<InfoTip label="About account actions"><b>Suspend</b> is temporary (undo with <b>Unsuspend</b>): {kind === "provider" ? "they aren't matched or offered shifts" : "they can't post shifts and standing bookings pause"}, but can still sign in. <b>Ban</b> is permanent: sign-in is disabled, upcoming work is released and their email can&apos;t sign up again. <b>Delete</b> removes the account; if it has past shifts or payments, personal details are erased and the records kept. Everything is logged.</InfoTip></>}
        action={impact.banned ? <Badge tone="red">Banned</Badge> : status === "SUSPENDED" ? <Badge tone="amber">Suspended</Badge> : null}
      />
      <CardBody className="space-y-4">
        <p className="text-xs text-slate-500">{upcomingLabel}.</p>
        {restricted ? (
          <ActionForm action={moderateAccountAction} className="space-y-2" confirm={`Unsuspend / reinstate this ${who}? They can sign in and use the platform again.`}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="reinstate" />
            <Input name="reason" placeholder="Note (optional)" />
            <SubmitButton size="sm" variant="secondary">{status === "SUSPENDED" && !impact.banned ? "Unsuspend" : "Reinstate (unban)"}</SubmitButton>
          </ActionForm>
        ) : null}
        {!restricted ? (
          <ActionForm action={moderateAccountAction} className="space-y-2" confirm={`Suspend this ${who}?`}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="suspend" />
            <Input name="reason" placeholder="Reason (required)" required minLength={3} />
            {impact.upcoming ? <Checkbox name="releaseUpcoming" label={kind === "provider" ? "Also release their upcoming shifts (clinics refunded, shifts reopened)" : "Also cancel their upcoming shifts"} /> : null}
            <SubmitButton size="sm" variant="outline">Suspend</SubmitButton>
          </ActionForm>
        ) : null}
        {!impact.banned ? (
          <ActionForm action={moderateAccountAction} className="space-y-2" confirm={`Ban this ${who} permanently? Sign-in is disabled and ${impact.upcoming ? "their upcoming shifts are released" : "they can't sign up again"}.`}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="ban" />
            <Input name="reason" placeholder="Reason (required)" required minLength={3} />
            <SubmitButton size="sm" variant="danger">Ban</SubmitButton>
          </ActionForm>
        ) : null}
        <details className="rounded-lg border border-red-200 bg-red-50/40 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-red-700">Delete account…</summary>
          <ActionForm action={deleteAccountAction} className="mt-3 space-y-2" confirm={`Delete this ${who}? This can't be undone.`}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <Input name="reason" placeholder="Reason (required)" required minLength={3} />
            <Input name="confirmText" placeholder="Type DELETE to confirm" required />
            <p className="text-xs text-slate-500">Upcoming work is released first. With past shifts or payments, personal details are erased and the records kept.</p>
            <SubmitButton size="sm" variant="danger">Delete permanently</SubmitButton>
          </ActionForm>
        </details>
      </CardBody>
    </Card>
  );
}
