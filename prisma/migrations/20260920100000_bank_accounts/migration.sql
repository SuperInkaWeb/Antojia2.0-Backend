ALTER TABLE "restaurants"
  ADD COLUMN "bankAccountNumberEncrypted" TEXT,
  ADD COLUMN "bankAccountNumberMasked" TEXT;

ALTER TABLE "delivery_drivers"
  ADD COLUMN "bankAccountNumberEncrypted" TEXT,
  ADD COLUMN "bankAccountNumberMasked" TEXT;
