ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TECH_ADMIN';

CREATE TYPE "ReportAudience" AS ENUM ('RESTAURANT', 'CONSUMER', 'DELIVERY');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

CREATE TABLE "support_reports" (
  "id" TEXT NOT NULL,
  "audience" "ReportAudience" NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "response" TEXT,
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "authorId" TEXT NOT NULL,
  "answeredById" TEXT,
  CONSTRAINT "support_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_reports_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "support_reports_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "support_reports_audience_category_createdAt_idx" ON "support_reports"("audience", "category", "createdAt");
CREATE INDEX "support_reports_authorId_createdAt_idx" ON "support_reports"("authorId", "createdAt");
CREATE INDEX "support_reports_status_createdAt_idx" ON "support_reports"("status", "createdAt");
