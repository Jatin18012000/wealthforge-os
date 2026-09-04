import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGET_CATALOG,
  defaultDashboardLayoutPreferences,
  normalizeDashboardLayoutPreferences,
  resolveVisibleDashboardWidgets,
} from "../../src/domain/dashboardLayout";

/** Fails the test immediately with a clear message rather than proceeding with `undefined`. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

describe("defaultDashboardLayoutPreferences", () => {
  it("shows every catalog widget, in catalog order, expanded, none favorited", () => {
    const prefs = defaultDashboardLayoutPreferences();
    expect(prefs.density).toBe("expanded");
    expect(prefs.widgets).toHaveLength(DASHBOARD_WIDGET_CATALOG.length);
    for (const [index, widget] of DASHBOARD_WIDGET_CATALOG.entries()) {
      const pref = must(prefs.widgets[index], `preference at index ${index}`);
      expect(pref.id).toBe(widget.id);
      expect(pref.visible).toBe(true);
      expect(pref.order).toBe(widget.defaultOrder);
      expect(pref.favorite).toBe(false);
    }
  });
});

describe("normalizeDashboardLayoutPreferences", () => {
  it("falls back to full defaults for undefined/null/non-object input", () => {
    expect(normalizeDashboardLayoutPreferences(undefined)).toEqual(
      defaultDashboardLayoutPreferences(),
    );
    expect(normalizeDashboardLayoutPreferences(null)).toEqual(
      defaultDashboardLayoutPreferences(),
    );
    expect(normalizeDashboardLayoutPreferences("not an object")).toEqual(
      defaultDashboardLayoutPreferences(),
    );
    expect(normalizeDashboardLayoutPreferences(42)).toEqual(
      defaultDashboardLayoutPreferences(),
    );
    expect(normalizeDashboardLayoutPreferences([])).toEqual(
      defaultDashboardLayoutPreferences(),
    );
  });

  it("drops any widget id that is not in the catalog rather than storing it", () => {
    const result = normalizeDashboardLayoutPreferences({
      density: "expanded",
      widgets: [
        { id: "not-a-real-widget", visible: false, order: 0, favorite: true },
        { id: "daily-brief", visible: false, order: 5, favorite: true },
      ],
    });
    expect(result.widgets.find((w) => w.id === "not-a-real-widget")).toBeUndefined();
    expect(result.widgets).toHaveLength(DASHBOARD_WIDGET_CATALOG.length);
    expect(result.widgets.find((w) => w.id === "daily-brief")).toEqual({
      id: "daily-brief",
      visible: false,
      order: 5,
      favorite: true,
    });
  });

  it("never lets a non-hideable widget be hidden, regardless of what was stored", () => {
    const result = normalizeDashboardLayoutPreferences({
      widgets: [{ id: "headline-tiles", visible: false, order: 1, favorite: false }],
    });
    const headline = result.widgets.find((w) => w.id === "headline-tiles");
    expect(headline?.visible).toBe(true);
  });

  it("fills in defaults for any catalog widget missing from the input", () => {
    const result = normalizeDashboardLayoutPreferences({
      widgets: [{ id: "daily-brief", visible: false, order: 99, favorite: true }],
    });
    expect(result.widgets).toHaveLength(DASHBOARD_WIDGET_CATALOG.length);
    const other = result.widgets.find((w) => w.id === "money-flow");
    const catalogEntry = DASHBOARD_WIDGET_CATALOG.find((w) => w.id === "money-flow");
    expect(other).toEqual({
      id: "money-flow",
      visible: true,
      order: catalogEntry?.defaultOrder,
      favorite: false,
    });
  });

  it("coerces non-boolean visible/favorite and non-numeric order to safe defaults", () => {
    const catalogEntry = must(DASHBOARD_WIDGET_CATALOG[2], "catalog entry 2");
    const result = normalizeDashboardLayoutPreferences({
      widgets: [
        { id: catalogEntry.id, visible: "yes", order: "not a number", favorite: 1 },
      ],
    });
    const pref = result.widgets.find((w) => w.id === catalogEntry.id);
    expect(pref?.visible).toBe(true); // non-boolean visible -> default true
    expect(pref?.order).toBe(catalogEntry.defaultOrder); // NaN order -> default order
    expect(pref?.favorite).toBe(false); // non-boolean favorite -> default false
  });

  it("clamps an out-of-range order into [0, catalog.length * 10]", () => {
    const catalogEntry = must(DASHBOARD_WIDGET_CATALOG[0], "catalog entry 0");
    const tooHigh = normalizeDashboardLayoutPreferences({
      widgets: [{ id: catalogEntry.id, visible: true, order: 999999, favorite: false }],
    });
    const tooLow = normalizeDashboardLayoutPreferences({
      widgets: [{ id: catalogEntry.id, visible: true, order: -999999, favorite: false }],
    });
    expect(must(tooHigh.widgets[0], "widget 0").order).toBe(DASHBOARD_WIDGET_CATALOG.length * 10);
    expect(must(tooLow.widgets[0], "widget 0").order).toBe(0);
  });

  it("falls back to 'expanded' for any density value other than the literal 'compact'", () => {
    expect(normalizeDashboardLayoutPreferences({ density: "compact" }).density).toBe(
      "compact",
    );
    expect(normalizeDashboardLayoutPreferences({ density: "huge" }).density).toBe(
      "expanded",
    );
    expect(normalizeDashboardLayoutPreferences({ density: 123 }).density).toBe("expanded");
  });
});

describe("resolveVisibleDashboardWidgets", () => {
  it("excludes hidden widgets", () => {
    const prefs = normalizeDashboardLayoutPreferences({
      widgets: [{ id: "daily-brief", visible: false, order: 0, favorite: false }],
    });
    const resolved = resolveVisibleDashboardWidgets(prefs);
    expect(resolved.find((w) => w.id === "daily-brief")).toBeUndefined();
    expect(resolved).toHaveLength(DASHBOARD_WIDGET_CATALOG.length - 1);
  });

  it("orders visible widgets by ascending order value", () => {
    const prefs = normalizeDashboardLayoutPreferences({
      widgets: [
        { id: "daily-brief", visible: true, order: 50, favorite: false },
        { id: "financial-independence-projection", visible: true, order: 0, favorite: false },
      ],
    });
    const resolved = resolveVisibleDashboardWidgets(prefs);
    expect(must(resolved[0], "resolved widget 0").id).toBe(
      "financial-independence-projection",
    );
  });

  it("floats every favorited widget above every non-favorited one", () => {
    const prefs = normalizeDashboardLayoutPreferences({
      widgets: [
        { id: "sip-increase-simulator", visible: true, order: 999, favorite: true },
      ],
    });
    const resolved = resolveVisibleDashboardWidgets(prefs);
    expect(must(resolved[0], "resolved widget 0").id).toBe("sip-increase-simulator");
  });

  it("breaks a tied order with the catalog's own default order", () => {
    const prefs = normalizeDashboardLayoutPreferences({
      widgets: DASHBOARD_WIDGET_CATALOG.map((w) => ({
        id: w.id,
        visible: true,
        order: 5,
        favorite: false,
      })),
    });
    const resolved = resolveVisibleDashboardWidgets(prefs);
    expect(resolved.map((w) => w.id)).toEqual(DASHBOARD_WIDGET_CATALOG.map((w) => w.id));
  });

  it("round-trips the full default catalog unchanged", () => {
    const resolved = resolveVisibleDashboardWidgets(defaultDashboardLayoutPreferences());
    expect(resolved.map((w) => w.id)).toEqual(DASHBOARD_WIDGET_CATALOG.map((w) => w.id));
  });
});
