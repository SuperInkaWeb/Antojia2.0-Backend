CREATE TABLE "tech_admin_invites" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "tokenHash" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "status" "MarketingAdminInviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdByEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tech_admin_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tech_admin_invites_email_key" ON "tech_admin_invites"("email");
CREATE UNIQUE INDEX "tech_admin_invites_tokenHash_key" ON "tech_admin_invites"("tokenHash");
CREATE INDEX "tech_admin_invites_status_idx" ON "tech_admin_invites"("status");
CREATE OR REPLACE FUNCTION enforce_tech_admin_invite_limit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(78124021);
    IF (SELECT COUNT(*) FROM "tech_admin_invites") >= 2 THEN
      RAISE EXCEPTION 'Maximum of 2 technical administrator accounts reached' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "tech_admin_invites_limit" BEFORE INSERT ON "tech_admin_invites" FOR EACH ROW EXECUTE FUNCTION enforce_tech_admin_invite_limit();
