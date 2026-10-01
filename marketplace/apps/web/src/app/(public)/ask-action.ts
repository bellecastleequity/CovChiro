"use server";

import { headers } from "next/headers";
import { growth } from "@cm/services";
import { errorMessage } from "@/lib/action";

export async function askQuestionAction(fd: FormData): Promise<{ answer: string; escalated: boolean } | { error: string }> {
  try {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
    return await growth.askQuestion({ name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""), question: String(fd.get("question") ?? ""), website: String(fd.get("website") ?? ""), startedAt: String(fd.get("startedAt") ?? "") || null, turnstileToken: String(fd.get("cf-turnstile-response") ?? "") || null }, ip ?? "unknown");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
