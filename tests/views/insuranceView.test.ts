import { afterAll, describe, expect, it } from "vitest";
import { applyOverride } from "../../src/manual/overrides";
import { getInsuranceView } from "../../src/views/insuranceView";
import { createTestDb } from "../setup/testDb";

describe("insurance view", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("shows no active term cover and no total when nothing is recorded", async () => {
    const view = await getInsuranceView(db);
    expect(view.policies).toEqual([]);
    expect(view.totalCoverMinorUnits).toBe(0);
    expect(view.hasActiveTermCover).toBe(false);
  });

  it("never fabricates a premium or cover amount that was never recorded", async () => {
    await db.insurancePolicy.create({
      data: {
        kind: "term",
        insuredParty: "User",
        coverAmountMinorUnits: null,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Unspecified",
        status: "planned",
      },
    });

    const view = await getInsuranceView(db);
    expect(view.policies[0]?.coverAmountMinorUnits).toBeNull();
    expect(view.policies[0]?.premiumMinorUnits).toBeNull();
    expect(view.hasActiveTermCover).toBe(false);
  });

  it("sums only active policies' cover amounts, skipping ones with no recorded amount", async () => {
    await db.insurancePolicy.create({
      data: {
        kind: "health_personal",
        insuredParty: "User",
        coverAmountMinorUnits: 250_000 * 100,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Unspecified",
        status: "active",
      },
    });
    await db.insurancePolicy.create({
      data: {
        kind: "health_family",
        insuredParty: "Family",
        coverAmountMinorUnits: 1_000_000 * 100,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Aditya Birla One NXT",
        status: "active",
      },
    });

    const view = await getInsuranceView(db);
    const activeTotal = view.policies
      .filter((p) => p.status === "active")
      .reduce((sum, p) => sum + (p.coverAmountMinorUnits ?? 0), 0);
    expect(view.totalCoverMinorUnits).toBe(activeTotal);
    expect(view.totalCoverMinorUnits).toBe(1_250_000 * 100);
  });

  it("reports an active term policy as cover in force", async () => {
    await db.insurancePolicy.create({
      data: {
        kind: "term",
        insuredParty: "User",
        coverAmountMinorUnits: 5_000_000 * 100,
        premiumMinorUnits: 12_000 * 100,
        premiumFrequency: "annual",
        provider: "Some Insurer",
        status: "active",
      },
    });

    const view = await getInsuranceView(db);
    expect(view.hasActiveTermCover).toBe(true);
  });

  it("layers a manual override onto a previously unrecorded premium, same as any other field", async () => {
    const policy = await db.insurancePolicy.create({
      data: {
        kind: "health_personal",
        insuredParty: "User",
        coverAmountMinorUnits: 250_000 * 100,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Unspecified",
        status: "active",
      },
    });

    const applied = await applyOverride(db, {
      entityType: "insurance_policy",
      entityId: policy.id,
      field: "premium",
      mode: "set",
      value: 8_500 * 100,
      reason: "Premium found on the renewal notice",
    });
    expect(applied.kind).toBe("ok");

    const view = await getInsuranceView(db);
    const updated = view.policies.find((p) => p.id === policy.id);
    expect(updated?.premiumMinorUnits).toBe(8_500 * 100);
  });
});
