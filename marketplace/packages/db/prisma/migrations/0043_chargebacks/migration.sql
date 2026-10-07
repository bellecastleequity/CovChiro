-- Card disputes (chargebacks) reported by Stripe.
CREATE TABLE IF NOT EXISTS "ChargeDispute" (
  "id" TEXT NOT NULL,
  "stripeDisputeId" TEXT NOT NULL,
  "stripePaymentIntent" TEXT,
  "paymentId" TEXT,
  "clinicOrgId" TEXT,
  "assignmentId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "evidenceDueBy" TIMESTAMPTZ(3),
  "evidenceSubmittedAt" TIMESTAMPTZ(3),
  "evidenceSubmittedBy" TEXT,
  "heldPayoutIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "adminNote" TEXT,
  "closedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChargeDispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChargeDispute_stripeDisputeId_key" ON "ChargeDispute"("stripeDisputeId");
CREATE INDEX IF NOT EXISTS "ChargeDispute_clinicOrgId_status_idx" ON "ChargeDispute"("clinicOrgId", "status");
CREATE INDEX IF NOT EXISTS "ChargeDispute_status_idx" ON "ChargeDispute"("status");
