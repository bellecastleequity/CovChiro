"use server";

import { revalidatePath } from "next/cache";
import { breaks } from "@cm/services";
import { bool, formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

export const previewBreakAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  return { ok: "", data: await breaks.previewBreak(actor, str(fd, "startDate")) };
});

export const startBreakAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  const r = await breaks.startBreak(actor, { startDate: str(fd, "startDate"), release: fd.getAll("release").map(String), keep: fd.getAll("keep").map(String) });
  revalidatePath("/provider", "layout");
  return { ok: "Your break is set.", data: r };
});

export const resumeAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  const r = await breaks.resumeCoverage(actor, { resumeDate: str(fd, "resumeDate"), hoursConfirmed: bool(fd, "hoursConfirmed") });
  revalidatePath("/provider", "layout");
  return { ok: r.now ? "Welcome back! You can take shifts again." : "Your return date is set.", data: r };
});
