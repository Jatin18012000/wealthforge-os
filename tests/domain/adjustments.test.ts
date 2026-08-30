import { describe, expect, it } from "vitest";
import {
  adjustmentKey,
  applyAdjustment,
  effectiveAdjustments,
  expectOk,
  previewAdjustment,
  resolveEffectiveValue,
  type AdjustmentInput,
} from "../../src/domain";

function adjustment(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return {
    id: "adj-1",
    entityType: "plan_record",
    entityId: "rec-1",
    field: "amount",
    unit: "money",
    mode: "set",
    sourceValueAtEntry: 50_000_00,
    adjustmentValue: 55_000_00,
    reason: null,
    createdAt: new Date("2026-08-10T00:00:00Z"),
    revokedAt: null,
    ...overrides,
  };
}

describe("manual adjustments", () => {
  describe("composition", () => {
    it("puts the most recent unrevoked adjustment in force", () => {
      const map = effectiveAdjustments([
        adjustment({ id: "old", adjustmentValue: 51_000_00 }),
        adjustment({
          id: "new",
          adjustmentValue: 57_000_00,
          createdAt: new Date("2026-08-12T00:00:00Z"),
        }),
      ]);

      expect(map.get(adjustmentKey("plan_record", "rec-1", "amount"))?.id).toBe("new");
    });

    it("ignores revoked adjustments entirely", () => {
      const map = effectiveAdjustments([
        adjustment({ id: "old", adjustmentValue: 51_000_00 }),
        adjustment({
          id: "withdrawn",
          adjustmentValue: 57_000_00,
          createdAt: new Date("2026-08-12T00:00:00Z"),
          revokedAt: new Date("2026-08-13T00:00:00Z"),
        }),
      ]);

      // The withdrawn one does not merely lose — it is absent, so the earlier
      // override applies again rather than the field being left unadjusted.
      expect(map.get(adjustmentKey("plan_record", "rec-1", "amount"))?.id).toBe("old");
    });

    it("breaks a same-millisecond tie deterministically instead of by row order", () => {
      const a = adjustment({ id: "aaa" });
      const b = adjustment({ id: "bbb" });

      expect(
        effectiveAdjustments([a, b]).get(adjustmentKey("plan_record", "rec-1", "amount"))
          ?.id,
      ).toBe(
        effectiveAdjustments([b, a]).get(adjustmentKey("plan_record", "rec-1", "amount"))
          ?.id,
      );
    });

    it("keeps different fields of the same record independent", () => {
      const map = effectiveAdjustments([
        adjustment({ id: "qty", entityType: "position_snapshot", field: "quantity" }),
        adjustment({ id: "cost", entityType: "position_snapshot", field: "costBasis" }),
      ]);

      expect(map.size).toBe(2);
    });
  });

  describe("resolution", () => {
    it("states source, adjustment and current for a set override", () => {
      const value = expectOk(resolveEffectiveValue(50_000_00, adjustment()));

      expect(value.sourceValue).toBe(50_000_00);
      expect(value.adjustmentValue).toBe(5_000_00);
      expect(value.currentValue).toBe(55_000_00);
    });

    it("re-applies a delta against whatever the source says today", () => {
      const delta = adjustment({ mode: "delta", adjustmentValue: 2_000_00 });

      // The import moved from 50,000 to 52,000; the +2,000 correction moves with it.
      expect(expectOk(resolveEffectiveValue(52_000_00, delta)).currentValue).toBe(
        54_000_00,
      );
    });

    it("refuses to add a delta to a source that has no value", () => {
      const delta = adjustment({ mode: "delta", adjustmentValue: 2_000_00 });
      const result = resolveEffectiveValue(null, delta);

      expect(result.kind).toBe("insufficient-data");
    });

    it("flags a stated override whose source has moved underneath it", () => {
      const value = expectOk(resolveEffectiveValue(52_000_00, adjustment()));

      // Recorded against 50,000, but the source now says 52,000. The override
      // still applies — dropping it would discard a human decision — and the
      // divergence is reported.
      expect(value.sourceMovedSince).toBe(true);
      expect(value.currentValue).toBe(55_000_00);
    });

    it("does not flag a stated override whose source is unchanged", () => {
      expect(
        expectOk(resolveEffectiveValue(50_000_00, adjustment())).sourceMovedSince,
      ).toBe(false);
    });

    it("treats an unadjusted value as exactly the source value", () => {
      expect(applyAdjustment(50_000_00, undefined)).toEqual({
        value: 50_000_00,
        effective: null,
        unresolved: [],
      });
    });

    it("leaves the source standing, with a reason, when an override cannot apply", () => {
      const applied = applyAdjustment(
        null,
        adjustment({ mode: "delta", adjustmentValue: 100 }),
      );

      expect(applied.value).toBeNull();
      expect(applied.unresolved).toHaveLength(1);
    });
  });

  describe("preview", () => {
    it("computes the arithmetic the user confirms", () => {
      const preview = expectOk(previewAdjustment(50_000_00, "set", 55_000_00, "money"));

      expect(preview.sourceValue).toBe(50_000_00);
      expect(preview.adjustmentValue).toBe(5_000_00);
      expect(preview.resultingValue).toBe(55_000_00);
    });

    it("says when an override would change nothing", () => {
      expect(
        expectOk(previewAdjustment(50_000_00, "set", 50_000_00, "money")).isNoOp,
      ).toBe(true);
    });

    it("rejects a fractional paise, which is not a storable amount", () => {
      expect(previewAdjustment(50_000_00, "set", 12.5, "money").kind).toBe(
        "insufficient-data",
      );
    });

    it("allows a fractional quantity, because mutual fund units are fractional", () => {
      expect(
        expectOk(previewAdjustment(10, "set", 12.5, "quantity")).resultingValue,
      ).toBe(12.5);
    });

    it("refuses a delta where there is no source to differ from", () => {
      expect(previewAdjustment(null, "delta", 500, "money").kind).toBe(
        "insufficient-data",
      );
    });
  });
});
