"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { testSigningEnabled } from "@cm/integrations";
import { markAgreementSigned, signAgreement } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { getSession, homeFor } from "@/lib/session";

export const devSignAction = formAction(async (fd) => {
  const s = await getSession();
  const sig = await prisma.agreementSignature.findUnique({ where: { envelopeId: str(fd, "envelope") } });
  if (!s || !sig || sig.signerUserId !== s.user.id || sig.provider !== "dev" || !testSigningEnabled()) throw new DomainError("FORBIDDEN", "Not allowed");
  await markAgreementSigned(sig.envelopeId!);
  redirect(homeFor(s.user.role));
});

export const signAgreementAction = formAction(async (fd) => {
  const s = await getSession();
  if (!s) throw new DomainError("FORBIDDEN", "Please sign in again.");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  const id = await signAgreement(
    s.actor,
    str(fd, "envelope"),
    { typedName: str(fd, "typedName"), title: fd.get("title") ? str(fd, "title") : null, consent: fd.get("consent") === "on", agree: fd.get("agree") === "on", viewedHash: str(fd, "viewedHash") },
    { ip, userAgent: h.get("user-agent") },
  );
  redirect(`/agreements/signed/${id}?new=1`);
});
