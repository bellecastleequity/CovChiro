import { describe, expect, it } from "vitest";
import { cleanNavOrder, defaultNavOrder, orderNav } from "../src/navorder";

const clinic = [
  { href: "/clinic", label: "Home" },
  { href: "/clinic/shifts/new", label: "Post shift" },
  { href: "/clinic/shifts", label: "Shifts" },
  { href: "/clinic/messages", label: "Messages" },
  { href: "/clinic/billing", label: "Billing" },
  { href: "/clinic/academy", label: "Training" },
];

describe("side menu order", () => {
  it("defaults to Home, Post shift, then A–Z", () => {
    expect(defaultNavOrder(clinic, "/clinic").map((i) => i.label)).toEqual(["Home", "Post shift", "Billing", "Messages", "Shifts", "Training"]);
    const prov = [{ href: "/provider/earnings", label: "Earnings" }, { href: "/provider/shifts", label: "Find shifts" }, { href: "/provider", label: "Home" }, { href: "/provider/assignments", label: "My shifts" }];
    expect(defaultNavOrder(prov, "/provider").map((i) => i.label)).toEqual(["Home", "Find shifts", "Earnings", "My shifts"]);
  });

  it("uses a saved order; new items slot in after it, removed ones are ignored", () => {
    const saved = ["/clinic/shifts", "/clinic", "/clinic/gone"];
    expect(orderNav(clinic, "/clinic", saved).map((i) => i.label)).toEqual(["Shifts", "Home", "Post shift", "Billing", "Messages", "Training"]);
    expect(orderNav(clinic, "/clinic", null).map((i) => i.label)[0]).toBe("Home");
  });

  it("cleans submitted orders", () => {
    expect(cleanNavOrder("/clinic", ["/clinic/billing", "/admin", "/clinic/billing", 5, "/clinicx", "/clinic"])).toEqual(["/clinic/billing", "/clinic"]);
    expect(cleanNavOrder("/clinic", "nope")).toEqual([]);
  });
});
