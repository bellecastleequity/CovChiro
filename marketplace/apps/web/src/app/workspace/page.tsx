import { redirect } from "next/navigation";
import { prisma } from "@cm/db";
import { Building2, Stethoscope } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { getSession, homeOf } from "@/lib/session";
import { brand } from "@cm/config";

export const metadata = { title: "Choose a workspace" };
export const dynamic = "force-dynamic";

/** After sign-in: a login with one side goes straight home; a clinic owner who also takes shifts picks a side. */
export default async function Workspace() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.user.role === "PLATFORM_ADMIN" || !(s.workspaces.provider && s.workspaces.clinic)) redirect(homeOf(s));
  const member = await prisma.clinicMember.findFirst({ where: { userId: s.user.id }, include: { clinicOrg: { select: { displayName: true } } }, orderBy: { role: "asc" } });
  const card = (to: "CLINIC" | "PROVIDER", title: string, sub: string, icon: React.ReactNode) => (
    <form action="/api/workspace" method="post">
      <input type="hidden" name="to" value={to} />
      <button className={`flex w-full items-center gap-4 rounded-2xl border bg-white p-5 text-left shadow-card transition hover:border-brand-400 ${s.workspace === to ? "border-brand-300" : "border-slate-200"}`}>
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">{icon}</span>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-slate-900">{title}</span>
          <span className="block truncate text-sm text-slate-500">{sub}</span>
        </span>
      </button>
    </form>
  );
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-10">
      <div className="mb-2"><Logo name={brand().name} /></div>
      <h1 className="text-2xl font-semibold text-slate-900">Welcome back, {s.user.name.split(" ")[0]}</h1>
      <p className="text-sm text-slate-500">Your login has two sides. Pick one; you can switch any time from the top of the page.</p>
      {card("CLINIC", member?.clinicOrg.displayName ?? "My clinic", "Post shifts, bookings, billing", <Building2 className="size-6" />)}
      {card("PROVIDER", "Taking shifts", "Find shifts, my bookings, earnings", <Stethoscope className="size-6" />)}
    </div>
  );
}
