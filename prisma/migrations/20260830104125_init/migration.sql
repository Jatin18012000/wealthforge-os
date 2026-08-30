-- CreateTable
CREATE TABLE "source_document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "rawBlobPath" TEXT
);

-- CreateTable
CREATE TABLE "sheet_snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDocumentId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "sheetKind" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "rawDataJson" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sheet_snapshot_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plan_record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodMonth" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "labelRaw" TEXT NOT NULL,
    "labelNormalized" TEXT NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sourceDocumentId" TEXT,
    "sheetSnapshotId" TEXT,
    "trustState" TEXT NOT NULL DEFAULT 'extracted',
    "supersededById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_record_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "plan_record_sheetSnapshotId_fkey" FOREIGN KEY ("sheetSnapshotId") REFERENCES "sheet_snapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "identifier" TEXT,
    "displayName" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "position_snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "asOfDate" DATETIME NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "trustState" TEXT NOT NULL DEFAULT 'extracted',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "position_snapshot_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "position_snapshot_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "valuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "asOfDate" DATETIME NOT NULL,
    "priceMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "valuation_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "instrumentId" TEXT,
    "goalId" TEXT,
    "liabilityId" TEXT,
    "amountMinorUnits" INTEGER NOT NULL,
    "occurredOn" DATETIME NOT NULL,
    "sourceDocumentId" TEXT,
    "trustState" TEXT NOT NULL DEFAULT 'extracted',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "activity_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "activity_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "liability" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "activity_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "liability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "principalMinorUnits" INTEGER NOT NULL,
    "outstandingMinorUnits" INTEGER NOT NULL,
    "outstandingAsOf" DATETIME NOT NULL,
    "interestRateBps" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "emiAmountMinorUnits" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "liability_payer_split" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liabilityId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    CONSTRAINT "liability_payer_split_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "liability" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetAmountMinorUnits" INTEGER NOT NULL,
    "targetDate" DATETIME,
    "priorityRank" INTEGER NOT NULL,
    "lifecycleState" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "insurance_policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "insuredParty" TEXT NOT NULL,
    "coverAmountMinorUnits" INTEGER NOT NULL,
    "premiumMinorUnits" INTEGER NOT NULL,
    "premiumFrequency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "revision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "originalValueJson" TEXT NOT NULL,
    "revisedValueJson" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "manual_adjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceValueJson" TEXT NOT NULL,
    "adjustmentJson" TEXT NOT NULL,
    "resultingValueJson" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "app_setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "source_document_fileHash_key" ON "source_document"("fileHash");

-- CreateIndex
CREATE INDEX "sheet_snapshot_sourceDocumentId_idx" ON "sheet_snapshot"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "plan_record_periodMonth_category_idx" ON "plan_record"("periodMonth", "category");

-- CreateIndex
CREATE INDEX "plan_record_supersededById_idx" ON "plan_record"("supersededById");

-- CreateIndex
CREATE INDEX "position_snapshot_instrumentId_asOfDate_idx" ON "position_snapshot"("instrumentId", "asOfDate");

-- CreateIndex
CREATE INDEX "valuation_instrumentId_asOfDate_idx" ON "valuation"("instrumentId", "asOfDate");

-- CreateIndex
CREATE INDEX "activity_goalId_occurredOn_idx" ON "activity"("goalId", "occurredOn");

-- CreateIndex
CREATE INDEX "activity_liabilityId_occurredOn_idx" ON "activity"("liabilityId", "occurredOn");

-- CreateIndex
CREATE INDEX "liability_payer_split_liabilityId_idx" ON "liability_payer_split"("liabilityId");

-- CreateIndex
CREATE INDEX "revision_entityType_entityId_idx" ON "revision"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "manual_adjustment_entityType_entityId_idx" ON "manual_adjustment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_event_kind_createdAt_idx" ON "audit_event"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_setting_key_key" ON "app_setting"("key");
