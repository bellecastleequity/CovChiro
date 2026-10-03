"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DomainError } from "@cm/core";
import { sandbox } from "@cm/services";
import { formAction as baseFormAction, str } from "@/lib/action";
import { homeFor, requireActor, SESSION_COOKIE, setSessionCookie } from "@/lib/session";

/** Holds the admin's own session while they look around as a demo account ("Back to admin"). */
const ADMIN_RETURN_COOKIE = "cm_sandbox_admin";

const formAction: typeof baseFormAction = (fn) => baseFormAction(fn, { technical: true });
const me = () => requireActor("admin");
const rv = () => revalidatePath("/admin/sandbox");

export const buildDemoAction = formAction(async (fd) => {
  const { actor } = await me();
  if (str(fd, "confirm").toUpperCase() !== "RESET") throw new DomainError("VALIDATION", "Type RESET to confirm. Everything on the test site except admin logins and settings is replaced.");
  const r = await sandbox.startBuild(actor);
  rv();
  return r;
});

export const topUpAction = formAction(async () => {
  const { actor } = await me();
  const r = await sandbox.startTopUp(actor);
  rv();
  return r;
});

export const stopBuildAction = formAction(async () => {
  const { actor } = await me();
  const r = await sandbox.cancelQueue(actor);
  rv();
  return r;
});

export const clearOutboxAction = formAction(async () => {
  const { actor } = await me();
  const r = await sandbox.clearOutbox(actor);
  rv();
  return r;
});

/** Open a demo login in this browser; the admin session is kept for "Back to admin". */
export const actAsAction = formAction(async (fd) => {
  const { actor } = await me();
  const jar = await cookies();
  const own = jar.get(SESSION_COOKIE)?.value;
  const { token, role } = await sandbox.actAs(actor, str(fd, "userId"), (await headers()).get("user-agent") ?? undefined);
  if (own) jar.set(ADMIN_RETURN_COOKIE, own, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 12 * 3600 });
  await setSessionCookie(token);
  redirect(homeFor(role));
});

export const addTesterAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await sandbox.addTester(actor, { name: str(fd, "name"), email: str(fd, "email"), password: String(fd.get("password") ?? "") });
  rv();
  return r;
});

export const removeTesterAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await sandbox.removeTester(actor, str(fd, "userId"));
  rv();
  return r;
});
