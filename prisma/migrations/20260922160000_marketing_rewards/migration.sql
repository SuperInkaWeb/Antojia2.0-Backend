CREATE TYPE "MarketingRewardType" AS ENUM ('PROMOTION', 'PURCHASE_REWARD');

CREATE TABLE "marketing_rewards" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "MarketingRewardType" NOT NULL,
  "code" TEXT,
  "discountPct" INTEGER,
  "discountAmount" DOUBLE PRECISION,
  "rewardPoints" INTEGER,
  "minPurchase" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "usageLimit" INTEGER,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_rewards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_rewards_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marketing_rewards_code_key" ON "marketing_rewards"("code");
CREATE INDEX "marketing_rewards_type_isActive_idx" ON "marketing_rewards"("type", "isActive");
CREATE INDEX "marketing_rewards_startsAt_endsAt_idx" ON "marketing_rewards"("startsAt", "endsAt");
