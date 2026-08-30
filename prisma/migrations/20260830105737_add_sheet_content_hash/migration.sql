-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sheet_snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDocumentId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "sheetKind" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "rawDataJson" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sheet_snapshot_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_sheet_snapshot" ("classification", "id", "importedAt", "rawDataJson", "sheetKind", "sheetName", "sourceDocumentId") SELECT "classification", "id", "importedAt", "rawDataJson", "sheetKind", "sheetName", "sourceDocumentId" FROM "sheet_snapshot";
DROP TABLE "sheet_snapshot";
ALTER TABLE "new_sheet_snapshot" RENAME TO "sheet_snapshot";
CREATE INDEX "sheet_snapshot_sourceDocumentId_idx" ON "sheet_snapshot"("sourceDocumentId");
CREATE INDEX "sheet_snapshot_sheetName_importedAt_idx" ON "sheet_snapshot"("sheetName", "importedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
