-- The value a source states outright for a holding at its snapshot date,
-- used verbatim instead of reconstructing price x quantity from a per-unit
-- price rounded to whole paise. Additive and nullable: every existing row
-- keeps valuing exactly as before.
ALTER TABLE "position_snapshot" ADD COLUMN "marketValueMinorUnits" INTEGER;
