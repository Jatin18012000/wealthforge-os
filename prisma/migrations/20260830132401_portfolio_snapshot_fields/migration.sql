-- AlterTable
ALTER TABLE "activity" ADD COLUMN "quantity" REAL;

-- AlterTable
ALTER TABLE "position_snapshot" ADD COLUMN "costBasisMinorUnits" INTEGER;
ALTER TABLE "position_snapshot" ADD COLUMN "supersededById" TEXT;

-- CreateIndex
CREATE INDEX "activity_instrumentId_occurredOn_idx" ON "activity"("instrumentId", "occurredOn");

-- CreateIndex
CREATE INDEX "position_snapshot_supersededById_idx" ON "position_snapshot"("supersededById");
