/**
 * Dashboard personalization (v1.1.1 F4): which Command Center widgets show,
 * in what order, which are favorited, and whether the layout is compact or
 * expanded.
 *
 * This module is pure and framework-free like the rest of `src/domain/` —
 * it knows nothing about `AppSetting`, Prisma, or HTTP. It only defines the
 * widget catalog (the fixed set of things that exist to be arranged) and
 * the rules for turning arbitrary stored JSON into a safe, complete
 * preference set. Untrusted input (a hand-edited cookie, a stale form,
 * a future export/import of settings) can never inject an unknown widget
 * id, an out-of-range order, or force a required widget to hide — this
 * function is the single choke point that guarantees that.
 */

export interface DashboardWidgetDefinition {
  /** Stable identifier. Never reused for a different widget once shipped. */
  readonly id: string;
  readonly label: string;
  readonly section: string;
  /** Position among all widgets when no preference has been set. */
  readonly defaultOrder: number;
  /**
   * Required widgets (the headline summary tiles) can never be hidden —
   * a personalized dashboard that could hide net worth entirely would
   * defeat the point of a financial command center.
   */
  readonly hideable: boolean;
}

/**
 * The fixed catalog of Command Center widgets, in the order the v1.1
 * Command Center spec defined (`docs/25_COMMAND_CENTER_V2_SPEC.md`). Adding
 * a new widget to the page means adding one entry here with the next
 * `defaultOrder` — nothing else in this module changes.
 */
export const DASHBOARD_WIDGET_CATALOG: readonly DashboardWidgetDefinition[] = [
  { id: "daily-brief", label: "WealthForge Daily Brief", section: "Daily Brief", defaultOrder: 0, hideable: true },
  { id: "headline-tiles", label: "Net worth, cash, portfolio, liabilities", section: "Headline", defaultOrder: 1, hideable: false },
  { id: "net-worth-trajectory", label: "Net worth trajectory", section: "Net worth trajectory & money flow", defaultOrder: 2, hideable: true },
  { id: "money-flow", label: "Monthly money flow", section: "Net worth trajectory & money flow", defaultOrder: 3, hideable: true },
  { id: "portfolio-xray", label: "Portfolio X-Ray", section: "Portfolio X-Ray & risk", defaultOrder: 4, hideable: true },
  { id: "concentration-heatmap", label: "Concentration heatmap", section: "Portfolio X-Ray & risk", defaultOrder: 5, hideable: true },
  { id: "drawdown-monitor", label: "Drawdown monitor", section: "Portfolio X-Ray & risk", defaultOrder: 6, hideable: true },
  { id: "budget-this-month", label: "This month (budget)", section: "Plan vs reality & adherence", defaultOrder: 7, hideable: true },
  { id: "plan-vs-reality", label: "Plan vs reality", section: "Plan vs reality & adherence", defaultOrder: 8, hideable: true },
  { id: "planned-vs-actual-allocation", label: "Planned vs actual allocation", section: "Plan vs reality & adherence", defaultOrder: 9, hideable: true },
  { id: "investment-plan-adherence", label: "Investment plan adherence", section: "Plan vs reality & adherence", defaultOrder: 10, hideable: true },
  { id: "goals-priority", label: "Goals in priority order", section: "Goal radar & EMI freedom", defaultOrder: 11, hideable: true },
  { id: "goal-funding-radar", label: "Goal funding radar", section: "Goal radar & EMI freedom", defaultOrder: 12, hideable: true },
  { id: "debt-freedom-meter", label: "Debt freedom meter", section: "Goal radar & EMI freedom", defaultOrder: 13, hideable: true },
  { id: "emi-release-timeline", label: "EMI release timeline", section: "Goal radar & EMI freedom", defaultOrder: 14, hideable: true },
  { id: "net-worth-waterfall", label: "Net worth waterfall", section: "Wealth waterfall & financial health", defaultOrder: 15, hideable: true },
  { id: "financial-health-score", label: "Financial health score", section: "Wealth waterfall & financial health", defaultOrder: 16, hideable: true },
  { id: "needs-attention", label: "Needs attention", section: "What needs attention & data health", defaultOrder: 17, hideable: true },
  { id: "data-health", label: "Data health", section: "What needs attention & data health", defaultOrder: 18, hideable: true },
  { id: "milestones", label: "Milestones", section: "What needs attention & data health", defaultOrder: 19, hideable: true },
  { id: "savings-investment-trend", label: "Savings & investment rate trend", section: "More intelligence", defaultOrder: 20, hideable: true },
  { id: "portfolio-growth-decomposition", label: "Portfolio growth decomposition", section: "More intelligence", defaultOrder: 21, hideable: true },
  { id: "contribution-vs-return", label: "Contribution vs return", section: "More intelligence", defaultOrder: 22, hideable: true },
  { id: "portfolio-performance", label: "Portfolio performance", section: "More intelligence", defaultOrder: 23, hideable: true },
  { id: "portfolio-vs-benchmark", label: "Portfolio vs benchmark", section: "More intelligence", defaultOrder: 24, hideable: true },
  { id: "goal-collision-detector", label: "Goal collision detector", section: "More intelligence", defaultOrder: 25, hideable: true },
  { id: "emergency-fund-runway", label: "Emergency fund runway", section: "More intelligence", defaultOrder: 26, hideable: true },
  { id: "goal-trade-off-simulator", label: "Goal trade-off simulator", section: "More intelligence", defaultOrder: 27, hideable: true },
  { id: "whats-changed", label: "What's changed", section: "More intelligence", defaultOrder: 28, hideable: true },
  { id: "financial-anomaly-detector", label: "Financial anomaly detector", section: "More intelligence", defaultOrder: 29, hideable: true },
  { id: "historical-coverage", label: "Historical coverage", section: "More intelligence", defaultOrder: 30, hideable: true },
  { id: "sip-increase-simulator", label: "SIP increase simulator", section: "Scenario engine", defaultOrder: 31, hideable: true },
  { id: "debt-prepayment-simulator", label: "Debt prepayment simulator", section: "Scenario engine", defaultOrder: 32, hideable: true },
  { id: "wealth-projection", label: "Wealth projection", section: "Scenario engine", defaultOrder: 33, hideable: true },
  { id: "financial-independence-projection", label: "Financial independence projection", section: "Scenario engine", defaultOrder: 34, hideable: true },
] as const;

const CATALOG_BY_ID = new Map(DASHBOARD_WIDGET_CATALOG.map((w) => [w.id, w]));

export type DashboardDensity = "compact" | "expanded";

export interface DashboardWidgetPreference {
  readonly id: string;
  readonly visible: boolean;
  readonly order: number;
  readonly favorite: boolean;
}

export interface DashboardLayoutPreferences {
  readonly density: DashboardDensity;
  readonly widgets: readonly DashboardWidgetPreference[];
}

const MIN_ORDER = 0;
const MAX_ORDER = DASHBOARD_WIDGET_CATALOG.length * 10;

/** The layout every user starts from, and what "reset" restores. */
export function defaultDashboardLayoutPreferences(): DashboardLayoutPreferences {
  return {
    density: "expanded",
    widgets: DASHBOARD_WIDGET_CATALOG.map((w) => ({
      id: w.id,
      visible: true,
      order: w.defaultOrder,
      favorite: false,
    })),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampOrder(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_ORDER, Math.max(MIN_ORDER, Math.round(n)));
}

/**
 * Turns arbitrary stored/submitted data into a complete, safe preference
 * set. Every catalog widget gets an entry (missing ones fall back to their
 * default); every entry in the input that names an unknown widget id is
 * dropped; every field is type- and range-checked rather than trusted.
 *
 * This is the only path allowed to produce a `DashboardLayoutPreferences`
 * from outside this module — both the persistence layer (reading what was
 * last saved) and the settings form handler (reading what the user just
 * submitted) go through this, so a corrupted or hand-crafted payload can
 * never reach the render path unvalidated.
 */
export function normalizeDashboardLayoutPreferences(
  input: unknown,
): DashboardLayoutPreferences {
  const defaults = defaultDashboardLayoutPreferences();
  if (!isPlainObject(input)) return defaults;

  const density: DashboardDensity = input.density === "compact" ? "compact" : "expanded";

  const suppliedById = new Map<string, unknown>();
  if (Array.isArray(input.widgets)) {
    for (const entry of input.widgets) {
      if (isPlainObject(entry) && typeof entry.id === "string" && CATALOG_BY_ID.has(entry.id)) {
        suppliedById.set(entry.id, entry);
      }
    }
  }

  const widgets = DASHBOARD_WIDGET_CATALOG.map((catalogEntry) => {
    const supplied = suppliedById.get(catalogEntry.id);
    const suppliedObj = isPlainObject(supplied) ? supplied : {};

    const visible = catalogEntry.hideable
      ? typeof suppliedObj.visible === "boolean"
        ? suppliedObj.visible
        : true
      : true; // required widgets can never be hidden, regardless of input

    return {
      id: catalogEntry.id,
      visible,
      order: clampOrder(suppliedObj.order, catalogEntry.defaultOrder),
      favorite: typeof suppliedObj.favorite === "boolean" ? suppliedObj.favorite : false,
    };
  });

  return { density, widgets };
}

export interface ResolvedDashboardWidget extends DashboardWidgetDefinition {
  readonly preference: DashboardWidgetPreference;
}

/**
 * The catalog, filtered to what should render and sorted into final
 * display order: favorited widgets first, then by the user's chosen
 * order, with the catalog's own default order as a stable tiebreak so
 * two widgets given the same order number don't jitter between renders.
 */
export function resolveVisibleDashboardWidgets(
  preferences: DashboardLayoutPreferences,
): readonly ResolvedDashboardWidget[] {
  const prefById = new Map(preferences.widgets.map((p) => [p.id, p]));

  const resolved: ResolvedDashboardWidget[] = [];
  for (const catalogEntry of DASHBOARD_WIDGET_CATALOG) {
    const preference = prefById.get(catalogEntry.id);
    if (preference === undefined || !preference.visible) continue;
    resolved.push({ ...catalogEntry, preference });
  }

  return resolved.sort((a, b) => {
    if (a.preference.favorite !== b.preference.favorite) {
      return a.preference.favorite ? -1 : 1;
    }
    if (a.preference.order !== b.preference.order) {
      return a.preference.order - b.preference.order;
    }
    return a.defaultOrder - b.defaultOrder;
  });
}
