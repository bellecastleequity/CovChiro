import { isSandbox } from "@cm/config";
import { missingMigrations, prisma } from "@cm/db";
import { emergency, hiring, support } from "@cm/services";
import type { AlertState } from "@cm/core";
import Link from "next/link";
import { phoneLabel } from "@/lib/format";
import { Alert } from "@/components/ui/misc";
import { AppShell } from "@/components/shell/app-shell";
import { installedRelease } from "@/lib/release";
import { dateTimeLabel } from "@/lib/format";
import type { NavItem } from "@/components/shell/nav-link";
import { requireActor } from "@/lib/session";
import { shortCached } from "@/lib/short-cache";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireActor("admin");
  // Menu badges + banners, all in parallel and cached for a few seconds (lib/short-cache).
  const { pending, tasks, disputes, missing, emergencies, hires, growthBadge, blogDrafts, supportOpen, healthState, sandboxBadge, urgent } = await shortCached("admin-layout", async () => {
    const [pending, tasks, disputes, missing, emergencies, hires, growthBadge, blogDrafts, supportOpen, health, sandboxBadge, urgent] = await Promise.all([
      Promise.all([prisma.license.count({ where: { status: "PENDING_VERIFICATION" } }), prisma.malpracticePolicy.count({ where: { status: "PENDING_VERIFICATION" } }), prisma.clinicVerification.count({ where: { status: "PENDING" } })]).then(([a, b, c]) => a + b + c),
      prisma.adminTask.count({ where: { resolvedAt: null } }),
      prisma.dispute.count({ where: { status: "OPEN" } }),
      missingMigrations(prisma),
      emergency.openEmergencyCount().catch(() => 0),
      hiring.openHireCount().catch(() => 0),
      Promise.all([prisma.communication.count({ where: { status: "PENDING_APPROVAL" } }), prisma.escalation.count({ where: { status: { not: "RESOLVED" } } })]).then(([a, b]) => a + b).catch(() => 0),
      prisma.blogPost.count({ where: { status: "DRAFT", aiGenerated: true, createdById: null } }).catch(() => 0),
      prisma.supportRequest.count({ where: { status: "OPEN" } }).catch(() => 0),
      // Open system-health problems (from the monitor's last run; cheap single row).
      prisma.setting.findUnique({ where: { key: "health.alertState" } }).catch(() => null),
      isSandbox() ? Promise.all([prisma.sandboxReport.count({ where: { status: "OPEN" } }), prisma.sandboxError.count({ where: { resolvedAt: null } })]).then(([a, b]) => a + b).catch(() => 0) : Promise.resolve(0),
      support.urgentWaiting().catch(() => []),
    ]);
    return { pending, tasks, disputes, missing, emergencies, hires, growthBadge, blogDrafts, supportOpen, healthState: ((health?.value as AlertState | null) ?? {}) as AlertState, sandboxBadge, urgent };
  });
  const healthOpen = Object.values(healthState);
  const healthCritical = healthOpen.filter((h) => h.severity === "critical");
  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard", icon: "dashboard", mobile: true },
    { href: "/admin/emergencies", label: "Emergencies", icon: "emergency", badge: emergencies, mobile: emergencies > 0 },
    { href: "/admin/verification", label: "Verification", icon: "verification", badge: pending, mobile: true },
    { href: "/admin/shifts", label: "Shifts", icon: "shifts", mobile: true },
    { href: "/admin/payouts", label: "Provider pay", icon: "payouts", mobile: true },
    { href: "/admin/timesheets", label: "Timesheets", icon: "timeclock" },
    { href: "/admin/providers", label: "Providers", icon: "providers" },
    { href: "/admin/clinics", label: "Clinics", icon: "clinics" },
    { href: "/admin/payments", label: "Payments & disputes", icon: "payments", badge: disputes },
    { href: "/admin/growth", label: "Growth", icon: "analytics", badge: growthBadge },
    { href: "/admin/leads", label: "Leads", icon: "leads", mobile: true },
    { href: "/admin/blog", label: "Blog", icon: "docs", badge: blogDrafts },
    { href: "/admin/recruitment", label: "Recruitment", icon: "leads" },
    { href: "/admin/schools", label: "Schools", icon: "leads" },
    { href: "/admin/funnel", label: "Provider funnel", icon: "analytics" },
    { href: "/admin/supply", label: "Provider supply", icon: "states" },
    { href: "/admin/promo", label: "Promo codes", icon: "promo" },
    { href: "/admin/referrals", label: "Referrals", icon: "refer" },
    { href: "/admin/rewards", label: "Rewards & Badges", icon: "rewards" },
    { href: "/admin/announcements", label: "Announcements", icon: "messages" },
    { href: "/admin/users", label: "Users & logins", icon: "team" },
    { href: "/admin/backups", label: "Backups & restore", icon: "backup" },
    { href: "/admin/health", label: "System health", icon: "health", badge: healthOpen.length },
    { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
    { href: "/admin/states", label: "States & professions", icon: "states" },
    { href: "/admin/rates", label: "Rates", icon: "rates" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
    { href: "/admin/hire", label: "Hire requests", icon: "providers", badge: hires },
    { href: "/admin/messages", label: "Blocked messages", icon: "messages" },
    { href: "/admin/tasks", label: "Tasks", icon: "tasks", badge: tasks },
    { href: "/admin/support", label: "Support", icon: "help", badge: supportOpen },
    { href: "/admin/audit", label: "Audit log", icon: "audit" },
    // Test site only: demo data, act as a demo account, the captured outbox.
    ...(isSandbox()
      ? [{ href: "/admin/sandbox", label: "Test site", icon: "sandbox" as const, mobile: true, badge: sandboxBadge }]
      : []),
  ];
  return (
    <AppShell items={items} root="/admin" userId={user.id} userName={user.name} subtitle="Platform admin" footnote={releaseNote()}>
      {missing.length ? (
        <Alert tone="error" className="mb-6" title="Database update needed">
          This version of the site expects database updates that haven't been run yet: {missing.join(", ")}. Run the matching update-NNN SQL file(s) from this release in Neon&apos;s SQL Editor, in number order. Until then, some pages (for example the provider dashboard) won&apos;t load.
        </Alert>
      ) : null}
      {healthCritical.length ? (
        <Alert tone="error" className="mb-6" title={`System problem${healthCritical.length === 1 ? "" : "s"}: ${healthCritical.map((h) => h.title).join(" · ")}`}>
          <Link href="/admin/health" className="font-medium underline">See what&apos;s wrong and how to fix it →</Link>
        </Alert>
      ) : null}
      {urgent.length ? (
        <Alert tone="error" className="mb-6" title={`Urgent help requested: ${urgent.length} waiting for a call, text or email`}>
          <ul className="mt-1 space-y-0.5">
            {urgent.map((u) => (
              <li key={u.id}>
                <Link href={`/admin/support/${u.id}`} className="font-medium underline">
                  {u.user.name}: {u.contactMethod === "EMAIL" ? `email ${u.contactEmail}` : `${u.contactMethod === "TEXT" ? "text" : "call"} ${phoneLabel(u.contactPhone)}`}
                </Link>{" "}
                · waiting {Math.max(1, Math.round((Date.now() - +u.createdAt) / 60_000))} min
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {children}
    </AppShell>
  );
}

/** "Version 2c36b28 · built Oct 10, 7:40 AM": the update package installed on this server. */
function releaseNote() {
  const rel = installedRelease();
  return <Link href="/admin/backups" className="hover:text-slate-600" title={rel.latestMigration ? `Database schema ${rel.latestMigration}` : undefined}>Version {rel.version}{rel.builtAt ? ` · built ${dateTimeLabel(new Date(rel.builtAt))}` : ""}</Link>;
}
