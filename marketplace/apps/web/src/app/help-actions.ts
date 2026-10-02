"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError } from "@cm/core";
import { support } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

/** Help center: contact support and reply (clinic or provider), and the admin inbox. */

async function member() {
  const s = await requireActor("any");
  if (s.actor.role === "PLATFORM_ADMIN") throw new DomainError("FORBIDDEN", "Admins use the support inbox.");
  return s;
}
const areaOf = (role: string) => (role === "PROVIDER" ? "/provider" : "/clinic");

export const contactSupportAction = formAction(async (fd) => {
  const { actor } = await member();
  const r = await support.createRequest(actor, { topic: str(fd, "topic"), subject: str(fd, "subject"), body: str(fd, "body"), shiftId: str(fd, "shiftId") || null });
  revalidatePath(`${areaOf(actor.role)}/help`, "layout");
  redirect(`${areaOf(actor.role)}/help/requests/${r.id}?sent=1`);
});

export const supportReplyAction = formAction(async (fd) => {
  const { actor } = await member();
  await support.reply(actor, str(fd, "id"), str(fd, "body"));
  revalidatePath(`${areaOf(actor.role)}/help`, "layout");
  return "Sent. We'll reply here and by email.";
});

export const supportCloseAction = formAction(async (fd) => {
  const { actor } = await member();
  await support.closeOwn(actor, str(fd, "id"));
  revalidatePath(`${areaOf(actor.role)}/help`, "layout");
  return "Closed. Reply any time to reopen it.";
});

export const adminSupportReplyAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await support.adminReply(actor, str(fd, "id"), str(fd, "body"), { close: str(fd, "close") === "1" });
  revalidatePath("/admin/support", "layout");
  return "Reply sent.";
});

export const adminSupportStatusAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  const status = str(fd, "status");
  await support.adminSetStatus(actor, str(fd, "id"), status === "CLOSED" ? "CLOSED" : status === "ANSWERED" ? "ANSWERED" : "OPEN");
  revalidatePath("/admin/support", "layout");
  return "Status updated.";
});
