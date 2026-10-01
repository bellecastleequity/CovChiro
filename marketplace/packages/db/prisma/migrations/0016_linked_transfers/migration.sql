-- Linked provider transfers: each Stripe transfer is tied to a clinic charge of the same booking
-- (source_transaction), so provider pay is set aside and never paid out to the platform. Re-runnable.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "transferredCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "PayoutTransferLeg" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "stripeTransferId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayoutTransferLeg_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayoutTransferLeg_idempotencyKey_key" ON "PayoutTransferLeg"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PayoutTransferLeg_stripeTransferId_key" ON "PayoutTransferLeg"("stripeTransferId");
CREATE INDEX IF NOT EXISTS "PayoutTransferLeg_transferId_idx" ON "PayoutTransferLeg"("transferId");
CREATE INDEX IF NOT EXISTS "PayoutTransferLeg_paymentId_idx" ON "PayoutTransferLeg"("paymentId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayoutTransferLeg_transferId_fkey') THEN
    ALTER TABLE "PayoutTransferLeg" ADD CONSTRAINT "PayoutTransferLeg_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "PayoutTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
