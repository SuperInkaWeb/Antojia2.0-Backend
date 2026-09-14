CREATE TABLE "platform_settings" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "commissionPercent" INTEGER NOT NULL DEFAULT 20,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_settings_commissionPercent_check" CHECK ("commissionPercent" BETWEEN 20 AND 40)
);

CREATE TABLE "restaurant_payouts" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "grossAmount" DOUBLE PRECISION NOT NULL,
  "commissionPercent" INTEGER NOT NULL,
  "commissionAmount" DOUBLE PRECISION NOT NULL,
  "netAmount" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurant_payouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_payouts_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "restaurant_withdrawals" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "bankName" TEXT NOT NULL,
  "accountHolder" TEXT NOT NULL,
  "destinationAccountMasked" TEXT NOT NULL,
  "bankDetailsEncrypted" TEXT NOT NULL,
  "transferReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurant_withdrawals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_withdrawals_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "restaurant_payouts_restaurantId_createdAt_idx" ON "restaurant_payouts"("restaurantId", "createdAt");
CREATE INDEX "restaurant_withdrawals_restaurantId_status_createdAt_idx" ON "restaurant_withdrawals"("restaurantId", "status", "createdAt");
CREATE INDEX "restaurant_withdrawals_status_createdAt_idx" ON "restaurant_withdrawals"("status", "createdAt");

INSERT INTO "platform_settings" ("id", "commissionPercent") VALUES ('main', 20) ON CONFLICT ("id") DO NOTHING;
