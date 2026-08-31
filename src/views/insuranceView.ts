import type { PrismaClient } from "@prisma/client";
import { loadInsurancePolicies, type InsurancePolicyDetail } from "../data/loaders";

export interface InsuranceView {
  readonly policies: readonly InsurancePolicyDetail[];
  readonly totalCoverMinorUnits: number;
  /**
   * Whether at least one term policy is currently `active`. Term insurance
   * is the one category the requirements doc calls out explicitly as
   * planned-but-not-yet-in-force (docs/02_REQUIREMENTS.md) — this is a
   * direct read of recorded `status` values, not a derived calculation, so
   * it stays in the view layer rather than `src/domain/`.
   */
  readonly hasActiveTermCover: boolean;
}

export async function getInsuranceView(db: PrismaClient): Promise<InsuranceView> {
  const policies = await loadInsurancePolicies(db);

  return {
    policies,
    totalCoverMinorUnits: policies
      .filter((p) => p.status === "active" && p.coverAmountMinorUnits !== null)
      .reduce((total, p) => total + (p.coverAmountMinorUnits as number), 0),
    hasActiveTermCover: policies.some((p) => p.kind === "term" && p.status === "active"),
  };
}
