import { describe, expect, it } from "vitest";
import {
  computeEmiAmount,
  computeTenureMonthsBetween,
  emiBurdenForPayer,
  expectOk,
  projectEmiRelease,
  splitEmiByPayer,
  sumMinorUnits,
  type LiabilityDetail,
} from "../../src/domain";

const AS_OF = new Date("2026-08-31T00:00:00Z");

const homeLoan = (overrides: Partial<LiabilityDetail> = {}): LiabilityDetail => ({
  id: "l1",
  name: "Home Loan / LAP",
  principalMinorUnits: 250_000_000,
  outstandingMinorUnits: 237_300_000,
  outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
  emiAmountMinorUnits: 2_841_600,
  tenureMonths: 180,
  interestRateBps: 850,
  payerSplits: [
    { payerName: "User", shareBps: 3_519, effectiveFrom: new Date("2026-07-01T00:00:00Z") },
    { payerName: "Father & Brother", shareBps: 6_481, effectiveFrom: new Date("2026-07-01T00:00:00Z") },
  ],
  ...overrides,
});

describe("EMI payer split", () => {
  it("splits the EMI so the shares sum back to exactly the EMI", () => {
    const shares = expectOk(splitEmiByPayer(homeLoan(), AS_OF));

    expect(shares).toHaveLength(2);
    // The parts must equal the whole — no rounding remainder may go missing.
    expect(sumMinorUnits(shares.map((s) => s.shareMinorUnits))).toBe(2_841_600);

    const user = shares.find((s) => s.payerName === "User");
    expect(user?.shareMinorUnits).toBe(999_959); // 35.19% of ₹28,416
  });

  it("refuses a split that does not total 100%", () => {
    const broken = homeLoan({
      payerSplits: [
        { payerName: "User", shareBps: 3_000, effectiveFrom: new Date("2026-07-01T00:00:00Z") },
      ],
    });
    const result = splitEmiByPayer(broken, AS_OF);

    // Normalizing 30% up to 100% would silently invent the missing payer.
    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons[0]).toContain("3000 bps");
    }
  });

  it("ignores splits not yet in effect", () => {
    const future = homeLoan({
      payerSplits: [
        { payerName: "User", shareBps: 10_000, effectiveFrom: new Date("2027-01-01T00:00:00Z") },
      ],
    });
    expect(splitEmiByPayer(future, AS_OF).kind).toBe("insufficient-data");
  });
});

describe("EMI burden", () => {
  it("computes a payer's burden against their own take-home, not the household EMI", () => {
    const burden = expectOk(emiBurdenForPayer([homeLoan()], "User", 6_350_000, AS_OF));

    expect(burden.totalShareMinorUnits).toBe(999_959);
    expect(burden.burdenRatio).toBeCloseTo(999_959 / 6_350_000, 10);
  });

  it("refuses rather than understating when any split is broken", () => {
    const broken = homeLoan({
      id: "l2",
      payerSplits: [
        { payerName: "User", shareBps: 5_000, effectiveFrom: new Date("2026-07-01T00:00:00Z") },
      ],
    });
    // Skipping the broken liability would report a burden that omits real debt.
    expect(emiBurdenForPayer([homeLoan(), broken], "User", 6_350_000, AS_OF).kind).toBe(
      "insufficient-data",
    );
  });

  it("reports an undefined burden against zero income", () => {
    expect(emiBurdenForPayer([homeLoan()], "User", 0, AS_OF).kind).toBe("insufficient-data");
  });

  it("reports insufficient data for a payer with no share anywhere", () => {
    expect(emiBurdenForPayer([homeLoan()], "Stranger", 6_350_000, AS_OF).kind).toBe(
      "insufficient-data",
    );
  });
});

describe("EMI release projection", () => {
  it("marks a projection with no payment history as schedule-only", () => {
    const release = expectOk(projectEmiRelease(homeLoan(), [], AS_OF));

    expect(release.paymentsMade).toBe(0);
    expect(release.paymentsRemaining).toBe(180);
    // A scheduled date must never be presented as an observed one.
    expect(release.fromScheduleOnly).toBe(true);
  });

  it("counts confirmed payments and shortens the remaining schedule", () => {
    const payments = [
      {
        id: "p1",
        liabilityId: "l1",
        amountMinorUnits: 2_841_600,
        occurredOn: new Date("2026-07-05T00:00:00Z"),
        trustState: "validated",
      },
      {
        id: "p2",
        liabilityId: "l1",
        amountMinorUnits: 2_841_600,
        occurredOn: new Date("2026-08-05T00:00:00Z"),
        trustState: "validated",
      },
      // Untrusted and future payments must not shorten the schedule.
      {
        id: "p3",
        liabilityId: "l1",
        amountMinorUnits: 2_841_600,
        occurredOn: new Date("2026-08-06T00:00:00Z"),
        trustState: "needs_review",
      },
      {
        id: "p4",
        liabilityId: "l1",
        amountMinorUnits: 2_841_600,
        occurredOn: new Date("2026-12-05T00:00:00Z"),
        trustState: "validated",
      },
    ];

    const release = expectOk(projectEmiRelease(homeLoan(), payments, AS_OF));
    expect(release.paymentsMade).toBe(2);
    expect(release.paymentsRemaining).toBe(178);
    expect(release.fromScheduleOnly).toBe(false);
  });

  it("refuses to project without a recorded tenure", () => {
    expect(projectEmiRelease(homeLoan({ tenureMonths: 0 }), [], AS_OF).kind).toBe(
      "insufficient-data",
    );
  });
});

describe("computeTenureMonthsBetween", () => {
  it("counts whole calendar months between two dates", () => {
    expect(
      computeTenureMonthsBetween(new Date("2026-01-15T00:00:00Z"), new Date("2027-01-15T00:00:00Z")),
    ).toBe(12);
  });

  it("ignores the day-of-month component", () => {
    expect(
      computeTenureMonthsBetween(new Date("2026-01-01T00:00:00Z"), new Date("2026-07-28T00:00:00Z")),
    ).toBe(6);
  });

  it("clamps to a minimum of 1 month, never zero or negative", () => {
    expect(
      computeTenureMonthsBetween(new Date("2026-01-15T00:00:00Z"), new Date("2026-01-20T00:00:00Z")),
    ).toBe(1);
    expect(
      computeTenureMonthsBetween(new Date("2026-06-15T00:00:00Z"), new Date("2026-01-15T00:00:00Z")),
    ).toBe(1);
  });
});

describe("computeEmiAmount", () => {
  it("splits an interest-free principal flat across the tenure", () => {
    expect(computeEmiAmount(60_00, 0, 60)).toBe(1_00); // ₹60 over 60 months, no interest → ₹1/month
  });

  it("computes a standard reducing-balance EMI at a real interest rate", () => {
    // ₹1,00,00,000 at 8.5% for 240 months — a textbook home-loan EMI check.
    const emi = computeEmiAmount(1_00_00_000 * 100, 850, 240);
    expect(emi).toBeGreaterThan(0);
    // Total repayment must exceed principal once interest is charged.
    expect(emi * 240).toBeGreaterThan(1_00_00_000 * 100);
  });

  it("returns zero for a non-positive tenure rather than dividing by zero", () => {
    expect(computeEmiAmount(1_00_000, 0, 0)).toBe(0);
    expect(computeEmiAmount(1_00_000, 850, -1)).toBe(0);
  });

  it("a higher interest rate never produces a lower EMI for the same principal and tenure", () => {
    const low = computeEmiAmount(1_00_000, 500, 12);
    const high = computeEmiAmount(1_00_000, 1500, 12);
    expect(high).toBeGreaterThan(low);
  });
});
