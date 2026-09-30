import { prisma } from "@cm/db";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-link";
import { requireActor } from "@/lib/session";

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { actor, user } = await requireActor("clinic");
  const [org, unread, newApps] = await Promise.all([
    prisma.clinicOrg.findUniqueOrThrow({ where: { id: actor.clinicOrgId! } }),
    prisma.message.count({ where: { readAt: null, senderType: "PROVIDER", thread: { clinicOrgId: actor.clinicOrgId! } } }),
    prisma.application.count({ where: { status: "ACTIVE", shift: { location: { clinicOrgId: actor.clinicOrgId! }, status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] } } } }),
  ]);
  const items: NavItem[] = [
    { href: "/clinic", label: "Home", icon: "dashboard", mobile: true },
    { href: "/clinic/shifts/new", label: "Post shift", icon: "post", mobile: true },
    { href: "/clinic/shifts", label: "Shifts", icon: "shifts", badge: newApps, mobile: true },
    { href: "/clinic/messages", label: "Messages", icon: "messages", badge: unread, mobile: true },
    { href: "/clinic/billing", label: "Billing", icon: "billing", mobile: true },
    { href: "/clinic/providers", label: "My providers", icon: "providers" },
    { href: "/clinic/locations", label: "Locations", icon: "locations" },
    { href: "/clinic/team", label: "Team", icon: "team" },
    { href: "/clinic/settings", label: "Settings", icon: "settings" },
  ];
  return (
    <AppShell items={items} root="/clinic" userId={user.id} userName={user.name} subtitle={org.displayName}>
      {children}
    </AppShell>
  );
}
