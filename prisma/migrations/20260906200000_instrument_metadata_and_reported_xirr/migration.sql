-- Source-reported descriptive metadata, retained for provenance. Nothing in
-- the engine calculates from these; instrument.category in particular is the
-- source's own wording and is NOT instrument.kind, which remains this app's
-- asset-class taxonomy. All additive and nullable: existing rows are
-- unaffected and every figure is computed exactly as before.
ALTER TABLE "instrument" ADD COLUMN "amc" TEXT;
ALTER TABLE "instrument" ADD COLUMN "category" TEXT;
ALTER TABLE "instrument" ADD COLUMN "subCategory" TEXT;
ALTER TABLE "instrument" ADD COLUMN "source" TEXT;

-- The XIRR the source reported for this holding at this date, in basis
-- points. Named "reported" so it can never be confused with the app's own
-- cash-flow-derived return calculation.
ALTER TABLE "position_snapshot" ADD COLUMN "reportedXirrBps" INTEGER;
