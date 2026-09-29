import { prisma } from "@cm/db";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-link";
import { requireActor } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireActor("admin");
  const [pending, tasks, disputes] = await Promise.all([
    prisma.license.count({ where: { status: "PENDING_VERIFICATION" } }).then(async (n) => n + (await prisma.malpracticePolicy.count({ where: { status: "PENDING_VERIFICATION" } }))),
    prisma.adminTask.count({ where: { resolvedAt: null } }),
    prisma.dispute.count({ where: { status: "OPEN" } }),
  ]);
  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard", icon: "dashboard", mobile: true },
    { href: "/admin/verification", label: "Verification", icon: "verification", badge: pending, mobile: true },
    { href: "/admin/shifts", label: "Shifts", icon: "shifts", mobile: true },
    { href: "/admin/payouts", label: "Provider pay", icon: "payouts", mobile: true },
    { href: "/admin/providers", label: "Providers", icon: "providers" },
    { href: "/admin/clinics", label: "Clinics", icon: "clinics" },
    { href: "/admin/payments", label: "Payments & disputes", icon: "payments", badge: disputes },
    { href: "/admin/leads", label: "Leads", icon: "leads", mobile: true },
    { href: "/admin/promo", label: "Promo codes", icon: "promo" },
    { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
    { href: "/admin/states", label: "States & professions", icon: "states" },
    { href: "/admin/rates", label: "Rates", icon: "rates" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
    { href: "/admin/tasks", label: "Tasks", icon: "tasks", badge: tasks },
    { href: "/admin/audit", label: "Audit log", icon: "audit" },
  ];
  return (
    <AppShell items={items} root="/admin" userId={user.id} userName={user.name} subtitle="Platform admin">
      {children}
    </AppShell>
  );
}
