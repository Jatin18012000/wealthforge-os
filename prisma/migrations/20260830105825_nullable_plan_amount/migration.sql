-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_plan_record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodMonth" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "labelRaw" TEXT NOT NULL,
    "labelNormalized" TEXT NOT NULL,
    "amountMinorUnits" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sourceDocumentId" TEXT,
    "sheetSnapshotId" TEXT,
    "trustState" TEXT NOT NULL DEFAULT 'extracted',
    "supersededById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_record_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "plan_record_sheetSnapshotId_fkey" FOREIGN KEY ("sheetSnapshotId") REFERENCES "sheet_snapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_plan_record" ("amountMinorUnits", "category", "createdAt", "currency", "id", "labelNormalized", "labelRaw", "periodMonth", "sheetSnapshotId", "sourceDocumentId", "supersededById", "trustState") SELECT "amountMinorUnits", "category", "createdAt", "currency", "id", "labelNormalized", "labelRaw", "periodMonth", "sheetSnapshotId", "sourceDocumentId", "supersededById", "trustState" FROM "plan_record";
DROP TABLE "plan_record";
ALTER TABLE "new_plan_record" RENAME TO "plan_record";
CREATE INDEX "plan_record_periodMonth_category_idx" ON "plan_record"("periodMonth", "category");
CREATE INDEX "plan_record_supersededById_idx" ON "plan_record"("supersededById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
