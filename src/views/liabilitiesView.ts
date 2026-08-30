import type { PrismaClient } from "@prisma/client";
import { loadLiabilities } from "../data/loaders";
import {
  projectEmiRelease,
  splitEmiByPayer,
  type Computed,
  type EmiPaymentInput,
  type LiabilityDetail,
  type PayerShare,
  type ReleaseSchedule,
} from "../domain";

export interface LiabilityCard {
  readonly liability: LiabilityDetail;
  readonly payerShares: Computed<readonly PayerShare[]>;
  readonly release: Computed<ReleaseSchedule>;
}

export interface LiabilitiesView {
  readonly asOf: Date;
  readonly cards: readonly LiabilityCard[];
  readonly totalOutstandingMinorUnits: number;
  readonly totalEmiMinorUnits: number;
}

/**
 * The name of the household member this app belongs to, as recorded on the
 * payer split. Held in settings rather than hardcoded so the EMI-burden view
 * shows *this* user's share rather than the whole household's.
 */
export const PRIMARY_PAYER_SETTING_KEY = "primary_payer_name";

export async function getLiabilitiesView(
  db: PrismaClient,
  asOf: Date,
): Promise<LiabilitiesView> {
  const liabilities = await loadLiabilities(db);

  const paymentRows = await db.activity.findMany({
    where: { kind: "emi_payment", liabilityId: { not: null } },
  });
  const payments: EmiPaymentInput[] = paymentRows.map((row) => ({
    id: row.id,
    liabilityId: row.liabilityId as string,
    amountMinorUnits: row.amountMinorUnits,
    occurredOn: row.occurredOn,
    trustState: row.trustState,
  }));

  const cards: LiabilityCard[] = liabilities.map((liability) => ({
    liability,
    payerShares: splitEmiByPayer(liability, asOf),
    release: projectEmiRelease(liability, payments, asOf),
  }));

  return {
    asOf,
    cards,
    totalOutstandingMinorUnits: liabilities.reduce(
      (total, l) => total + l.outstandingMinorUnits,
      0,
    ),
    totalEmiMinorUnits: liabilities.reduce((total, l) => total + l.emiAmountMinorUnits, 0),
  };
}

/** The configured primary payer, or null when none has been set. */
export async function getPrimaryPayerName(db: PrismaClient): Promise<string | null> {
  const setting = await db.appSetting.findUnique({
    where: { key: PRIMARY_PAYER_SETTING_KEY },
  });
  if (setting === null) return null;
  const parsed: unknown = JSON.parse(setting.valueJson);
  return typeof parsed === "string" ? parsed : null;
}
