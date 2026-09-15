-- AlterTable
ALTER TABLE "plan_record" ADD COLUMN "emiEndDate" DATETIME;

-- CreateTable
CREATE TABLE "emi_label_link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labelNormalized" TEXT NOT NULL,
    "liabilityId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emi_label_link_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "liability" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "emi_label_link_labelNormalized_key" ON "emi_label_link"("labelNormalized");
