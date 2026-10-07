import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { refreshProviderStripe, setTaxEntity, tax } from "@cm/services";
import { makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

describe("tax info and the 1099 report", () => {
  it("company vs individual can change only until payouts are on; switching starts a fresh Stripe setup", async () => {
    const p = await makeProvider();
    await prisma.provider.update({ where: { id: p.id }, data: { stripePayoutsEnabled: false } });
    expect(await setTaxEntity(p.actor, "COMPANY")).toBe("COMPANY");
    expect(await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ taxEntity: "COMPANY", stripeAccountId: null });
    const q = await makeProvider(); // payouts on
    await expect(setTaxEntity(q.actor, "COMPANY")).rejects.toThrow(/Contact support/);
  });

  it("refreshing from Stripe records the tax info status (never the number)", async () => {
    const p = await makeProvider();
    await refreshProviderStripe(p.id);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).taxInfoStatus).toBe("COMPLETE");
  });

  it("totals a provider's paid payouts for the year and flags the threshold", async () => {
    const p = await makeProvider();
    const year = 2031;
    const paidAt = new Date(Date.UTC(year, 5, 1));
    await prisma.payout.createMany({
      data: [
        { providerId: p.id, kind: "SHIFT", description: "Shift", amountCents: 150_000, status: "PAID", paidAt },
        { providerId: p.id, kind: "ADJUSTMENT", description: "Referral reward", amountCents: 2_000, status: "PAID", paidAt },
        { providerId: p.id, kind: "SHIFT", description: "Not paid yet", amountCents: 99_000, status: "SCHEDULED" },
        { providerId: p.id, kind: "SHIFT", description: "Next year", amountCents: 99_000, status: "PAID", paidAt: new Date(Date.UTC(year + 1, 0, 2)) },
      ],
    });
    const r = await tax.form1099Report(admin, year);
    const row = r.rows.find((x) => x.id === p.id)!;
    expect(row).toMatchObject({ totalCents: 152_000, adjustmentsCents: 2_000, overThreshold: false });
    await prisma.payout.create({ data: { providerId: p.id, kind: "LATE_CANCEL", description: "Late cancel", amountCents: 50_000, status: "PAID", paidAt } });
    expect((await tax.form1099Report(admin, year)).rows.find((x) => x.id === p.id)?.overThreshold).toBe(true);
    expect(tax.form1099Csv(await tax.form1099Report(admin, year))).toMatch(/Total paid/);
  });
});
