-- M8 manual controls: identify which field an adjustment overrides, how it
-- relates to the source value, and whether it has been withdrawn.
--
-- Additive only. Existing rows (there are none in any real database yet, but
-- the migration must be safe regardless) keep their source/adjustment/result
-- JSON untouched and take the defaults below.
ALTER TABLE "manual_adjustment" ADD COLUMN "field" TEXT NOT NULL DEFAULT '';
ALTER TABLE "manual_adjustment" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'money';
ALTER TABLE "manual_adjustment" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'set';
ALTER TABLE "manual_adjustment" ADD COLUMN "revokedAt" DATETIME;

CREATE INDEX "manual_adjustment_revokedAt_idx" ON "manual_adjustment"("revokedAt");
