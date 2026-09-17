CREATE TYPE "MarketingAdminInviteStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

CREATE TABLE "marketing_admin_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "MarketingAdminInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_admin_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_admin_invites_email_key" ON "marketing_admin_invites"("email");
CREATE INDEX "marketing_admin_invites_status_idx" ON "marketing_admin_invites"("status");

-- Conserva el acceso de las cuentas marketing existentes y reserva sus cupos.
INSERT INTO "marketing_admin_invites" ("id", "email", "status", "createdByEmail", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, LOWER("email"), 'APPROVED', 'migración', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "role" = 'MARKETING_ADMIN'
ON CONFLICT ("email") DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_marketing_admin_invite_limit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(78124020);
    IF (SELECT COUNT(*) FROM "marketing_admin_invites") >= 2 THEN
      RAISE EXCEPTION 'Maximum of 2 marketing administrator accounts reached' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "marketing_admin_invites_limit"
BEFORE INSERT ON "marketing_admin_invites"
FOR EACH ROW EXECUTE FUNCTION enforce_marketing_admin_invite_limit();
