"use server";

import { chat, type Actor } from "@cm/services";
import { errorMessage } from "@/lib/action";
import { getSession } from "@/lib/session";

/** The chat bubble's server calls (signed-in clinics and providers; visitors use askQuestionAction). */
type R<T> = ({ ok: true } & T) | { ok: false; error: string };

async function me(): Promise<Actor> {
  const s = await getSession();
  const role = s?.actor.role;
  if (!s || !(role === "PROVIDER" || role === "CLINIC_OWNER" || role === "CLINIC_STAFF")) throw new Error("Please sign in again.");
  return s.actor;
}

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function chatAskAction(question: string) {
  return run(async () => chat.assistantAnswer(await me(), question));
}

export async function chatHumanAction(lines: chat.ChatLine[]) {
  return run(async () => chat.talkToPerson(await me(), lines.slice(-20).map((l) => ({ from: l.from, text: String(l.text).slice(0, 1000) }))));
}

export async function chatThreadAction(requestId: string) {
  return run(async () => chat.chatThread(await me(), requestId));
}

export async function chatSendAction(requestId: string, text: string) {
  return run(async () => {
    await chat.chatSend(await me(), requestId, text);
    return {};
  });
}
