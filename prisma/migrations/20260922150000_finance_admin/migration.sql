ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE_ADMIN';

CREATE TABLE "finance_admin_invites" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "tokenHash" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "status" "MarketingAdminInviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdByEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_admin_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finance_admin_invites_email_key" ON "finance_admin_invites"("email");
CREATE UNIQUE INDEX "finance_admin_invites_tokenHash_key" ON "finance_admin_invites"("tokenHash");
CREATE INDEX "finance_admin_invites_status_idx" ON "finance_admin_invites"("status");
