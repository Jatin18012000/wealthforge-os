import type { PrismaClient } from "@prisma/client";
import { getCommandCenterView, type CommandCenterView } from "./commandCenterView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "./context";
import { getMarketView, type MarketView } from "./marketView";
import { formatDate, formatMoney } from "../presentation/format";

/**
 * A locally generated, rule-based summary report.
 *
 * Deliberately NOT the AI Analyst (M11): every line here is a direct
 * restatement of an already-computed domain/view output, template-filled,
 * with no natural-language generation and no model in the loop. This is
 * the same "structured payload of already-computed domain outputs"
 * docs/12_AI_ANALYST_SPEC.md describes as what the AI layer will
 * eventually receive — this report is that payload, made human-readable
 * directly, ahead of M11 giving it a narrative layer.
 *
 * Every statement is labeled FACT, INFERENCE, or RECOMMENDATION
 * (docs/23, "clearly distinguish"). A RECOMMENDATION is always phrased as
 * a suggestion; nothing here is ever executed automatically.
 */

export type ReportLineKind = "fact" | "inference" | "recommendation";

export interface ReportLine {
  readonly kind: ReportLineKind;
  readonly text: string;
}

export interface ReportSection {
  readonly title: string;
  readonly lines: readonly ReportLine[];
}

export interface Report {
  readonly generatedAt: Date;
  readonly asOf: Date;
  readonly periodMonth: string | null;
  readonly sections: readonly ReportSection[];
}

export function fact(text: string): ReportLine {
  return { kind: "fact", text };
}
export function inference(text: string): ReportLine {
  return { kind: "inference", text };
}
export function recommendation(text: string): ReportLine {
  return { kind: "recommendation", text };
}

function marketSection(market: MarketView): ReportSection {
  const lines: ReportLine[] = [];
  for (const index of market.indices) {
    if (index.latestPriceMinorUnits === null) {
      lines.push(
        fact(
          `${index.label}: no data (${index.hasFreeSource ? "not yet refreshed" : "no free source available, see D-016"})`,
        ),
      );
      continue;
    }
    lines.push(
      fact(
        `${index.label} stood at ${formatMoney(index.latestPriceMinorUnits)} as of ${formatDate(index.asOfDate as Date)}${index.isStale ? " — stale" : ""}`,
      ),
    );
  }
  return { title: "Market", lines };
}

function portfolioSection(view: CommandCenterView): ReportSection {
  const lines: ReportLine[] = [];

  if (view.portfolio.valuation.kind === "ok") {
    lines.push(
      fact(
        `Portfolio is valued at ${formatMoney(view.portfolio.valuation.value.totalMinorUnits)}`,
      ),
    );
  } else {
    lines.push(
      fact(
        "Portfolio value: insufficient data — " +
          view.portfolio.valuation.reasons.join("; "),
      ),
    );
  }

  if (
    view.portfolio.stalestPriceAgeDays !== null &&
    view.portfolio.stalestPriceAgeDays > 3
  ) {
    lines.push(
      inference(
        `The oldest price behind this valuation is ${view.portfolio.stalestPriceAgeDays} days old — part of the total may not reflect recent market movement`,
      ),
    );
    lines.push(
      recommendation(
        "Consider refreshing market data before relying on this valuation for a decision",
      ),
    );
  }

  for (const slice of view.portfolio.concentrated) {
    lines.push(
      inference(
        `${slice.key} makes up ${(slice.ratio * 100).toFixed(1)}% of the priced portfolio — concentrated`,
      ),
    );
    recommendationForConcentration(slice.key, lines);
  }

  return { title: "Portfolio", lines };
}

function recommendationForConcentration(label: string, lines: ReportLine[]): void {
  lines.push(
    recommendation(
      `Review whether the concentration in ${label} still matches your intended allocation`,
    ),
  );
}

function goalsSection(view: CommandCenterView): ReportSection {
  const lines: ReportLine[] = [];

  for (const card of view.goals.active) {
    const ratio =
      card.progress.progressRatio.kind === "ok"
        ? card.progress.progressRatio.value
        : null;
    lines.push(
      fact(
        `${card.goal.name}: ${formatMoney(card.progress.currentAmountMinorUnits)} of ${formatMoney(card.goal.targetAmountMinorUnits)}${ratio === null ? "" : ` (${(ratio * 100).toFixed(0)}%)`}`,
      ),
    );
  }

  // Whether cash could actually be allocated is a decision `canAllocateToGoal`
  // answers at the moment of allocation (M4); this report only observes that
  // both conditions worth mentioning are true, it does not perform or
  // authorize an allocation.
  const emergencyFund = view.goals.active.find((card) => card.progress.isProtected);
  if (
    emergencyFund !== undefined &&
    view.cashMinorUnits !== null &&
    view.cashMinorUnits > 0 &&
    emergencyFund.progress.remainingMinorUnits > 0
  ) {
    lines.push(
      inference(
        `Unallocated cash of ${formatMoney(view.cashMinorUnits)} is available this period`,
      ),
    );
    lines.push(
      recommendation(
        `${emergencyFund.goal.name} is below target — consider directing some of this cash there before other spending`,
      ),
    );
  }

  return { title: "Goals", lines };
}

function riskSection(view: CommandCenterView): ReportSection {
  const lines: ReportLine[] = view.alerts.map((alert) =>
    alert.level === "caution"
      ? inference(`${alert.title} — ${alert.detail}`)
      : fact(`${alert.title} — ${alert.detail}`),
  );
  if (lines.length === 0) lines.push(fact("No alerts are currently raised."));
  return { title: "Risk", lines };
}

export async function getReport(db: PrismaClient): Promise<Report> {
  const asOf = await resolveAsOf(db);
  const periodMonth = await resolveLatestPeriod(db);
  const periods = await listPeriods(db);

  const [commandCenter, market] = await Promise.all([
    getCommandCenterView(db, asOf, periodMonth, periods),
    getMarketView(db, asOf),
  ]);

  return {
    generatedAt: new Date(),
    asOf,
    periodMonth,
    sections: [
      marketSection(market),
      portfolioSection(commandCenter),
      goalsSection(commandCenter),
      riskSection(commandCenter),
    ],
  };
}
