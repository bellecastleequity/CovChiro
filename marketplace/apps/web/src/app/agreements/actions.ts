"use server";

import { redirect } from "next/navigation";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { testSigningEnabled } from "@cm/integrations";
import { markAgreementSigned } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { getSession, homeFor } from "@/lib/session";

export const devSignAction = formAction(async (fd) => {
  const s = await getSession();
  const sig = await prisma.agreementSignature.findUnique({ where: { envelopeId: str(fd, "envelope") } });
  if (!s || !sig || sig.signerUserId !== s.user.id || sig.provider !== "dev" || !testSigningEnabled()) throw new DomainError("FORBIDDEN", "Not allowed");
  await markAgreementSigned(sig.envelopeId!);
  redirect(homeFor(s.user.role));
});
