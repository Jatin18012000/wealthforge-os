-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_insurance_policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "insuredParty" TEXT NOT NULL,
    "coverAmountMinorUnits" INTEGER,
    "premiumMinorUnits" INTEGER,
    "premiumFrequency" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_insurance_policy" ("coverAmountMinorUnits", "createdAt", "effectiveFrom", "id", "insuredParty", "kind", "premiumFrequency", "premiumMinorUnits", "provider", "status") SELECT "coverAmountMinorUnits", "createdAt", "effectiveFrom", "id", "insuredParty", "kind", "premiumFrequency", "premiumMinorUnits", "provider", "status" FROM "insurance_policy";
DROP TABLE "insurance_policy";
ALTER TABLE "new_insurance_policy" RENAME TO "insurance_policy";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
