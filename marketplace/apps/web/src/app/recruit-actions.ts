"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { shiftRecruit } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

/** Recruit a provider for a shift: admin links, provider claims. */

export const createRecruitLinkAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await shiftRecruit.createLink(actor, str(fd, "shiftId"), str(fd, "label") || null);
  revalidatePath(`/admin/shifts/${str(fd, "shiftId")}`);
  return "Link ready. Copy it or the message below and send it to your colleague.";
});

export const claimRecruitAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  await shiftRecruit.claimAsProvider(actor, str(fd, "token"));
  revalidatePath("/provider", "layout");
  redirect("/provider?recruit=1#recruited");
});

export const markAvailableForRecruitAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  const r = await shiftRecruit.markAvailableForClaim(actor, str(fd, "claimId"));
  revalidatePath("/provider", "layout");
  return r.invited ? "You're available, and the shift is ready to accept in Offers." : "Marked available for that day.";
});
