import Link from "next/link";
import { accounts } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { userDeleteAction, userSuspendAction } from "../actions";

export const metadata = { title: "Users & logins" };
export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { PROVIDER: "Provider", CLINIC_OWNER: "Clinic owner", CLINIC_STAFF: "Clinic staff", PLATFORM_ADMIN: "Admin" };

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const status = f.status === "suspended" || f.status === "active" ? f.status : "all";
  const rows = await accounts.listUsers(actor, { q: f.q, role: f.role || undefined, status });
  return (
    <>
      <PageHeader
        title="Users & logins"
        description="Every login on the platform. Suspend stops one login from signing in (sessions end right away) until you unsuspend it; nothing else changes. To stop a provider being matched or a clinic posting, suspend the account from its provider or clinic page; that's linked on each row."
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Name, email or phone" className="w-64" />
        <Select name="role" defaultValue={f.role ?? ""} className="w-40"><option value="">All roles</option>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select name="status" defaultValue={status} className="w-36"><option value="all">Any status</option><option value="active">Can sign in</option><option value="suspended">Suspended</option></Select>
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      <Card className="overflow-x-auto">
        <Table>
          <thead><tr><Th>Login</Th><Th>Role / account</Th><Th>Status</Th><Th>Activity</Th><Th className="w-80">Actions</Th></tr></thead>
          <tbody>
            {rows.length ? rows.map((u) => {
              const self = u.id === actor.userId;
              return (
                <tr key={u.id} className="align-top">
                  <Td><div className="font-medium text-slate-900">{u.name}</div><div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div></Td>
                  <Td className="text-sm">
                    {ROLE[u.role] ?? u.role}
                    {u.provider ? <div><Link href={`/admin/providers/${u.provider.id}`} className="text-xs text-brand-700">Provider account ({u.provider.status.toLowerCase()}) →</Link></div> : null}
                    {u.clinics.map((c) => <div key={c.id}><Link href={`/admin/clinics/${c.id}`} className="text-xs text-brand-700">{c.displayName} ({c.status.toLowerCase()}) →</Link></div>)}
                  </Td>
                  <Td>{u.banned ? <Badge tone="red">Banned</Badge> : u.suspended ? <Badge tone="amber">Suspended</Badge> : <Badge tone="green">Can sign in</Badge>}</Td>
                  <Td className="text-xs text-slate-500">Joined {dateLabel(u.createdAt)}<br />{u.lastLoginAt ? `Last sign-in ${dateLabel(u.lastLoginAt)}` : "Never signed in"}</Td>
                  <Td>
                    {self ? <span className="text-xs text-slate-400">That's you</span> : (
                      <div className="space-y-2">
                        {u.suspended ? (
                          <ActionForm action={userSuspendAction} confirm={`Unsuspend ${u.name}? They can sign in again.`}><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="suspend" value="false" /><SubmitButton size="sm" variant="secondary">Unsuspend</SubmitButton></ActionForm>
                        ) : (
                          <ActionForm action={userSuspendAction} className="flex gap-1" confirm={`Suspend ${u.name}? They're signed out and can't sign in until you unsuspend them.`}>
                            <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="suspend" value="true" />
                            <Input name="reason" placeholder="Reason" required minLength={3} className="h-8 w-40 text-xs" />
                            <SubmitButton size="sm" variant="outline">Suspend</SubmitButton>
                          </ActionForm>
                        )}
                        <details>
                          <summary className="cursor-pointer text-xs text-red-700">Delete…</summary>
                          <ActionForm action={userDeleteAction} className="mt-2 space-y-1" confirm={`Delete ${u.name}'s login? This can't be undone.`}>
                            <input type="hidden" name="userId" value={u.id} />
                            <Input name="reason" placeholder="Reason" required minLength={3} className="h-8 text-xs" />
                            <Input name="confirmText" placeholder="Type DELETE" required className="h-8 text-xs" />
                            <SubmitButton size="sm" variant="danger">Delete login</SubmitButton>
                          </ActionForm>
                        </details>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            }) : <tr><Td className="text-slate-500">No users match.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      <p className="mt-2 text-xs text-slate-500">Showing up to 200, newest first. Providers and a clinic&apos;s only login are deleted from their account page so upcoming shifts are released properly.</p>
    </>
  );
}
