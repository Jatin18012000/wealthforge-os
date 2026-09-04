import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGET_CATALOG, defaultDashboardLayoutPreferences } from "../../src/domain";
import {
  getDashboardLayoutPreferences,
  resetDashboardLayoutPreferences,
  saveDashboardLayoutPreferences,
} from "../../src/views/dashboardLayoutStore";
import { createTestDb } from "../setup/testDb";

describe("dashboardLayoutStore", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  it("returns full defaults when nothing has been saved yet", async () => {
    const prefs = await getDashboardLayoutPreferences(db);
    expect(prefs).toEqual(defaultDashboardLayoutPreferences());
  });

  it("saves and reads back a normalized preference set", async () => {
    const saved = await saveDashboardLayoutPreferences(db, {
      density: "compact",
      widgets: [{ id: "daily-brief", visible: false, order: 3, favorite: true }],
    });
    expect(saved.density).toBe("compact");

    const reloaded = await getDashboardLayoutPreferences(db);
    expect(reloaded).toEqual(saved);
    expect(reloaded.widgets.find((w) => w.id === "daily-brief")).toEqual({
      id: "daily-brief",
      visible: false,
      order: 3,
      favorite: true,
    });
  });

  it("re-normalizes on save, so an unknown widget id or a hidden required widget never persists", async () => {
    await saveDashboardLayoutPreferences(db, {
      widgets: [
        { id: "not-a-real-widget", visible: true, order: 0, favorite: false },
        { id: "headline-tiles", visible: false, order: 0, favorite: false },
      ],
    });
    const reloaded = await getDashboardLayoutPreferences(db);
    expect(reloaded.widgets.find((w) => w.id === "not-a-real-widget")).toBeUndefined();
    expect(reloaded.widgets.find((w) => w.id === "headline-tiles")?.visible).toBe(true);
  });

  it("degrades to defaults if the stored row is corrupted JSON, rather than throwing", async () => {
    await db.appSetting.upsert({
      where: { key: "dashboardLayoutPreferences" },
      create: { key: "dashboardLayoutPreferences", valueJson: "{not valid json" },
      update: { valueJson: "{not valid json" },
    });
    const prefs = await getDashboardLayoutPreferences(db);
    expect(prefs).toEqual(defaultDashboardLayoutPreferences());
  });

  it("reset restores every widget to visible, default order, unfavorited, expanded", async () => {
    await saveDashboardLayoutPreferences(db, {
      density: "compact",
      widgets: [{ id: "daily-brief", visible: false, order: 30, favorite: true }],
    });
    const reset = await resetDashboardLayoutPreferences(db);
    expect(reset).toEqual(defaultDashboardLayoutPreferences());

    const reloaded = await getDashboardLayoutPreferences(db);
    expect(reloaded).toEqual(defaultDashboardLayoutPreferences());
    expect(reloaded.widgets).toHaveLength(DASHBOARD_WIDGET_CATALOG.length);
  });
});
