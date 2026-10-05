"use server";

import { revalidatePath } from "next/cache";
import { attendance, type Actor } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

/** Signed in (assignment page) or the signed one-tap link (/c/<token>): who's asking, and for which booking. */
async function who(fd: FormData): Promise<{ actor: Actor | null; id: string; token: string }> {
  const token = str(fd, "token");
  if (token) {
    const id = attendance.assignmentIdFromToken(token);
    if (!id) throw new (await import("@cm/core")).DomainError("NOT_FOUND", "This link isn't valid.");
    return { actor: null, id, token };
  }
  const { actor } = await requireActor("provider");
  return { actor, id: str(fd, "assignmentId"), token: "" };
}

const position = (fd: FormData) => {
  const lat = Number(str(fd, "lat"));
  const lng = Number(str(fd, "lng"));
  return str(fd, "lat") && str(fd, "lng") && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const refresh = (token: string) => (token ? revalidatePath(`/c/${token}`) : revalidatePath("/provider", "layout"));

/** "On my way", with the phone's position when the provider allowed it (→ arrival time for the clinic). */
export const onMyWayAction = formAction(async (fd) => {
  const w = await who(fd);
  const r = await attendance.markOnMyWay(w.actor, w.id, position(fd));
  refresh(w.token);
  return r;
});

/** A newer position while the page is open → updated arrival time (throttled on the server). */
export const arrivalPositionAction = formAction(async (fd) => {
  const w = await who(fd);
  const pos = position(fd);
  if (!pos) return { ok: "", data: null };
  const s = await attendance.reportPosition(w.actor, w.id, pos);
  return { ok: "", data: { sharing: s.sharing, etaAt: s.etaAt?.toISOString() ?? null, miles: s.miles, nextInSeconds: s.nextInSeconds } };
});
