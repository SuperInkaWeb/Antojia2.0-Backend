ALTER TABLE "marketing_admin_invites" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "marketing_admin_invites" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "marketing_admin_invites" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "marketing_admin_invites_tokenHash_key" ON "marketing_admin_invites"("tokenHash");

-- Los enlaces contienen un token aleatorio. La base de datos conserva solamente su hash.
