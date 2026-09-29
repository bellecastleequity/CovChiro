"use server";

import { DomainError } from "@cm/core";
import { leads } from "@cm/services";
import { formAction, str } from "@/lib/action";

export const unsubscribeAction = formAction(async (fd) => {
  const ok = await leads.unsubscribe(str(fd, "token"));
  if (!ok) throw new DomainError("VALIDATION", "This unsubscribe link is invalid or has already been used.");
  return "You're unsubscribed. You won't receive any more offer emails from us.";
});
