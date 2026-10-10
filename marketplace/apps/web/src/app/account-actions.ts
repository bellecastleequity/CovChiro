"use server";

import { revalidatePath } from "next/cache";
import { calendar } from "@cm/services";
import { formAction } from "@/lib/action";
import { requireActor } from "@/lib/session";
import { clearShortCache } from "@/lib/short-cache";

export const resetCalendarAction = formAction(async () => {
  const { user } = await requireActor("any");
  await calendar.resetCalendarToken(user.id);
  revalidatePath("/", "layout");
  return "New calendar link made. Calendars using the old link stop updating; subscribe again with the new one.";
});

export const saveNavOrderAction = async (root: string, hrefs: string[] | null) => {
  const { user } = await requireActor("any");
  const { navprefs } = await import("@cm/services");
  if (!["/admin", "/clinic", "/provider"].includes(root)) return { error: "Unknown menu." };
  if (hrefs === null) await navprefs.resetNavOrder(user.id, root);
  else await navprefs.saveNavOrder(user.id, root, hrefs);
  clearShortCache();
  revalidatePath(root, "layout");
  return { ok: hrefs === null ? "Menu reset to the default order." : "Menu order saved." };
};

/** Profile / Settings: unlink Google from this login (needs a password to sign in afterwards). */
export const disconnectGoogleAction = formAction(async () => {
  const { actor } = await requireActor("any");
  const { google } = await import("@cm/services");
  const msg = await google.disconnectGoogle(actor);
  revalidatePath("/", "layout");
  return msg;
});
