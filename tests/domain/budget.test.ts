import { describe, expect, it } from "vitest";
import {
  activityCategory,
  comparePlanVsActual,
  expectOk,
  summarizeMonth,
  type ActivityInput,
  type PlanRecordInput,
} from "../../src/domain";

const plan = (overrides: Partial<PlanRecordInput> = {}): PlanRecordInput => ({
  id: "r1",
  periodMonth: "2026-08",
  category: "expense",
  labelRaw: "Groceries",
  amountMinorUnits: 810_000,
  trustState: "validated",
  ...overrides,
});

const AUGUST: PlanRecordInput[] = [
  plan({ id: "income", category: "income", labelRaw: "Salary", amountMinorUnits: 6_350_000 }),
  plan({ id: "groceries", category: "expense", amountMinorUnits: 810_000 }),
  plan({ id: "utilities", category: "expense", labelRaw: "Utilities", amountMinorUnits: 305_000 }),
  plan({ id: "emi", category: "emi", labelRaw: "Home Loan EMI", amountMinorUnits: 2_800_000 }),
  plan({ id: "sip", category: "investment", labelRaw: "SIP", amountMinorUnits: 1_650_000 }),
];

describe("monthly budget summary", () => {
  it("reports each component separately rather than one ambiguous surplus", () => {
    const budget = expectOk(summarizeMonth(AUGUST, "2026-08"));

    expect(budget.incomeMinorUnits).toBe(6_350_000);
    expect(budget.expenseMinorUnits).toBe(1_115_000);
    expect(budget.emiMinorUnits).toBe(2_800_000);
    expect(budget.investmentMinorUnits).toBe(1_650_000);

    // Money not consumed...
    expect(budget.retainedMinorUnits).toBe(6_350_000 - 1_115_000 - 2_800_000);
    // ...and of that, what is left after investing.
    expect(budget.unallocatedMinorUnits).toBe(6_350_000 - 1_115_000 - 2_800_000 - 1_650_000);
  });

  it("computes rates against income", () => {
    const budget = expectOk(summarizeMonth(AUGUST, "2026-08"));
    expect(expectOk(budget.savingsRate)).toBeCloseTo(2_435_000 / 6_350_000, 10);
    expect(expectOk(budget.investmentRate)).toBeCloseTo(1_650_000 / 6_350_000, 10);
  });

  it("reports rates as insufficient when no income is recorded", () => {
    const noIncome = AUGUST.filter((r) => r.category !== "income");
    const budget = expectOk(summarizeMonth(noIncome, "2026-08"));

    // Amounts are still knowable; the ratios against income are not.
    expect(budget.expenseMinorUnits).toBe(1_115_000);
    expect(budget.savingsRate.kind).toBe("insufficient-data");
    expect(budget.investmentRate.kind).toBe("insufficient-data");
  });

  it("excludes untrusted records and names them", () => {
    const withUntrusted = [
      ...AUGUST,
      plan({ id: "dubious", labelRaw: "Mystery", amountMinorUnits: 9_999_900, trustState: "needs_review" }),
    ];
    const budget = expectOk(summarizeMonth(withUntrusted, "2026-08"));

    expect(budget.expenseMinorUnits).toBe(1_115_000);
    expect(budget.exclusions.map((e) => e.label)).toContain("Mystery");
  });

  it("excludes a record with no extractable amount instead of counting it as zero", () => {
    const withNull = [...AUGUST, plan({ id: "tbd", labelRaw: "TBD line", amountMinorUnits: null })];
    const budget = expectOk(summarizeMonth(withNull, "2026-08"));

    expect(budget.expenseMinorUnits).toBe(1_115_000);
    expect(budget.exclusions.find((e) => e.label === "TBD line")?.reason).toBe(
      "no extractable amount",
    );
  });

  it("ignores records belonging to other months", () => {
    const withJuly = [...AUGUST, plan({ id: "july", periodMonth: "2026-07", amountMinorUnits: 500_000 })];
    const budget = expectOk(summarizeMonth(withJuly, "2026-08"));
    expect(budget.expenseMinorUnits).toBe(1_115_000);
  });

  it("returns insufficient-data for a month with nothing trusted", () => {
    expect(summarizeMonth(AUGUST, "2027-01").kind).toBe("insufficient-data");
  });
});

describe("plan vs reality", () => {
  const activity = (overrides: Partial<ActivityInput> = {}): ActivityInput => ({
    id: "a1",
    kind: "one_time_expense",
    amountMinorUnits: 900_000,
    occurredOn: new Date("2026-08-15T00:00:00Z"),
    trustState: "validated",
    ...overrides,
  });

  it("reports absent actuals as null coverage, never as a zero actual", () => {
    const comparison = expectOk(comparePlanVsActual(AUGUST, [], "2026-08"));

    expect(comparison.hasNoActuals).toBe(true);
    for (const category of comparison.categories) {
      // Reporting 0 here would claim a 100% underspend that never happened.
      expect(category.actualMinorUnits).toBeNull();
      expect(category.varianceMinorUnits).toBeNull();
      expect(category.coverage).toBe("no-actual-data");
    }
  });

  it("computes absolute and proportional variance where actuals exist", () => {
    const comparison = expectOk(comparePlanVsActual(AUGUST, [activity()], "2026-08"));

    const expense = comparison.categories.find((c) => c.category === "expense");
    expect(expense?.coverage).toBe("complete");
    expect(expense?.actualMinorUnits).toBe(900_000);
    // Planned 1,115,000 against actual 900,000 — an underspend.
    expect(expense?.varianceMinorUnits).toBe(-215_000);
    expect(expense?.varianceRatio).toBeCloseTo(-215_000 / 1_115_000, 10);

    // Categories with no activity stay uncovered rather than reading as zero.
    expect(comparison.categories.find((c) => c.category === "emi")?.coverage).toBe(
      "no-actual-data",
    );
  });

  it("ignores activity from other months and untrusted activity", () => {
    const activities = [
      activity({ id: "wrong-month", occurredOn: new Date("2026-07-15T00:00:00Z") }),
      activity({ id: "untrusted", trustState: "needs_review" }),
    ];
    const comparison = expectOk(comparePlanVsActual(AUGUST, activities, "2026-08"));
    expect(comparison.hasNoActuals).toBe(true);
  });

  it("excludes goal transfers, which move money between the household's own buckets", () => {
    // Counting a goal contribution as spending would double-count money
    // already captured as income or investment.
    expect(activityCategory("goal_contribution")).toBeNull();
    expect(activityCategory("goal_withdrawal")).toBeNull();
    expect(activityCategory("sip")).toBe("investment");
    expect(activityCategory("emi_payment")).toBe("emi");

    const comparison = expectOk(
      comparePlanVsActual(AUGUST, [activity({ kind: "goal_contribution" })], "2026-08"),
    );
    expect(comparison.hasNoActuals).toBe(true);
  });

  it("leaves variance ratio undefined against a zero plan", () => {
    const zeroPlan = [
      plan({ id: "income", category: "income", amountMinorUnits: 100_000 }),
      plan({ id: "rent", category: "expense", labelRaw: "Rent", amountMinorUnits: 0 }),
    ];
    const comparison = expectOk(
      comparePlanVsActual(zeroPlan, [activity({ amountMinorUnits: 50_000 })], "2026-08"),
    );

    const expense = comparison.categories.find((c) => c.category === "expense");
    expect(expense?.varianceMinorUnits).toBe(50_000);
    // An infinite overspend percentage is not a useful thing to display.
    expect(expense?.varianceRatio).toBeNull();
  });

  it("rejects a malformed period string", () => {
    expect(comparePlanVsActual(AUGUST, [], "not-a-month").kind).toBe("insufficient-data");
  });

  /**
   * This project has no distinct "credit card" domain concept — a card
   * purchase is recorded as an ordinary expense line (e.g. "Card A" in the
   * budget workbook), and paying off the card's statement is recorded as
   * a liability instalment (`emi_payment`) if the card carries a revolving
   * balance modeled as a `Liability`. The double-counting risk this guards
   * against: a card purchase must land in `expense` exactly once, a card
   * bill payment settling that liability must land in `emi` exactly once,
   * and the two must never be summed into each other — otherwise the same
   * rupee would be counted twice (once as spending, once as debt service)
   * or the household's real outflow would be understated by netting them.
   */
  it("never double-counts a credit card purchase (expense) against its bill payment (liability settlement)", () => {
    const cardPurchase = activity({
      id: "card-a-purchase",
      kind: "one_time_expense",
      amountMinorUnits: 500_000,
    });
    const cardBillPayment = activity({
      id: "card-a-bill-payment",
      kind: "emi_payment",
      amountMinorUnits: 500_000,
    });

    const comparison = expectOk(
      comparePlanVsActual(AUGUST, [cardPurchase, cardBillPayment], "2026-08"),
    );

    const expense = comparison.categories.find((c) => c.category === "expense");
    const emi = comparison.categories.find((c) => c.category === "emi");

    // The purchase counts once, under expense...
    expect(expense?.actualMinorUnits).toBe(500_000);
    // ...and the bill payment counts once, under emi — not folded into
    // expense, and not summed with the purchase into either bucket.
    expect(emi?.actualMinorUnits).toBe(500_000);

    // Total money the categorization attributes across both buckets equals
    // exactly the two real transactions — proof neither was counted twice
    // and neither swallowed the other.
    expect((expense?.actualMinorUnits ?? 0) + (emi?.actualMinorUnits ?? 0)).toBe(
      cardPurchase.amountMinorUnits + cardBillPayment.amountMinorUnits,
    );
  });
});
