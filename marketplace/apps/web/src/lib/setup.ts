import { enrollment, growth, providerChecklist } from "@cm/services";

export type SetupItem = { label: string; done: boolean; href?: string; hint?: string };
export type SetupStatus = { items: SetupItem[]; readyLabel: string; base: string };

type ProviderChecklist = Awaited<ReturnType<typeof providerChecklist>>;

/** Everything a provider must finish before they can be matched (home checklist + header status). */
export function providerSetupItems(checklist: ProviderChecklist, email: string): SetupItem[] {
  const c = checklist.common;
  return [
    { label: "Confirm your email", done: c.emailVerified, hint: `We sent a link to ${email}. Not there? Check spam, or tap “Resend confirmation email” at the top of the page.` },
    { label: "Complete your profile, phone & home base", done: c.profile && c.homeBase, href: "/provider/profile" },
    { label: "Add a profile photo", done: c.photo, href: "/provider/profile" },
    { label: "Add your NPI", done: c.npi, href: "/provider/profile" },
    ...checklist.perProfession.flatMap((p) => [
      { label: `${p.displayName}: verified license`, done: p.license, href: "/provider/credentials", hint: p.licensePending ? "Submitted — verification in progress." : undefined },
      { label: `${p.displayName}: malpractice coverage`, done: p.malpractice, href: "/provider/credentials" },
    ]),
    { label: "Set up payouts & tax info (Stripe)", done: c.payouts, href: "/provider/payouts", hint: c.taxInfoNeeded ? "Payouts are on, but Stripe still needs your full SSN or EIN for your 1099." : undefined },
    { label: "Sign the Provider Platform Agreement", done: c.agreement, href: "/provider/profile#agreement" },
  ];
}

export async function providerSetupStatus(providerId: string, email: string): Promise<SetupStatus> {
  const items = providerSetupItems(await providerChecklist(providerId), email);
  // Enrolled ahead of their state opening: ready, but there are no shifts there yet.
  let readyLabel = "Ready for shifts";
  if (items.every((i) => i.done)) {
    const m = await enrollment.enrollmentStatus(providerId);
    if (!m.inOpenMarket && m.waiting.length) readyLabel = `Ready · waiting for ${m.waiting[0].state} to open`;
  }
  return { items, readyLabel, base: "/provider" };
}

/** What a clinic must finish before it can post (the first request itself isn't a setup step). */
export async function clinicSetupStatus(orgId: string): Promise<SetupStatus | null> {
  const c = await growth.clinicChecklist(orgId);
  if (!c) return null;
  const items = c.steps.filter((s) => s.key !== "account" && s.key !== "request").map((s) => ({ label: s.label, done: s.done, href: s.url }));
  return { items, readyLabel: "Ready to post", base: "/clinic" };
}
