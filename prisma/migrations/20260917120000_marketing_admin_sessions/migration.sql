ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MARKETING_ADMIN';

CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "admin_sessions_userId_startedAt_idx" ON "admin_sessions"("userId", "startedAt");

CREATE OR REPLACE FUNCTION enforce_marketing_admin_limit() RETURNS trigger AS $$
BEGIN
  IF NEW."role" = 'MARKETING_ADMIN' AND (TG_OP = 'INSERT' OR OLD."role" IS DISTINCT FROM NEW."role") THEN
    PERFORM pg_advisory_xact_lock(78124019);
    IF (SELECT COUNT(*) FROM "users" WHERE "role" = 'MARKETING_ADMIN' AND "id" <> NEW."id") >= 2 THEN
      RAISE EXCEPTION 'Maximum of 2 marketing administrators reached' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_marketing_admin_limit"
BEFORE INSERT OR UPDATE OF "role" ON "users"
FOR EACH ROW EXECUTE FUNCTION enforce_marketing_admin_limit();
