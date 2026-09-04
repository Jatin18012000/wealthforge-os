"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DASHBOARD_WIDGET_CATALOG } from "../../domain";
import { db } from "../../lib/db";
import { applyOverride, revokeOverride } from "../../manual/overrides";
import { findOverridableField } from "../../manual/registry";
import {
  resetDashboardLayoutPreferences,
  saveDashboardLayoutPreferences,
} from "../../views/dashboardLayoutStore";
import { parseEntryValue } from "../../presentation/parse";
import { toMode } from "../../views/settingsView";

/**
 * The two writes this application performs from the browser.
 *
 * Both re-derive everything from the form's identifying fields and the
 * database — never from a computed figure posted back — so a stale or
 * tampered form cannot put a number into the financial record that the
 * rules would not produce right now.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/** Where to send the user back to, preserving the budget period they were viewing. */
function settingsUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== ""),
  );
  const query = search.toString();
  return query === "" ? "/settings" : `/settings?${query}`;
}

export async function applyOverrideAction(form: FormData): Promise<void> {
  const entityType = text(form, "entityType");
  const field = text(form, "field");
  const period = text(form, "period");

  const definition = findOverridableField(entityType, field);
  if (definition === undefined) {
    redirect(
      settingsUrl({
        period,
        error: `"${entityType}.${field}" is not an overridable field`,
      }),
    );
  }

  const parsed = parseEntryValue(text(form, "value"), definition.unit);
  if (parsed.kind !== "ok") {
    redirect(settingsUrl({ period, error: parsed.reasons.join("; ") }));
  }

  const reason = text(form, "reason").trim();
  const result = await applyOverride(db, {
    entityType,
    entityId: text(form, "entityId"),
    field,
    mode: toMode(text(form, "mode")),
    value: parsed.value,
    reason: reason === "" ? null : reason,
  });

  if (result.kind !== "ok") {
    redirect(settingsUrl({ period, error: result.reasons.join("; ") }));
  }

  // Every screen reads the effective value, so every screen changes.
  revalidatePath("/", "layout");
  redirect(settingsUrl({ period, applied: definition.label }));
}

export async function revokeOverrideAction(form: FormData): Promise<void> {
  const period = text(form, "period");
  const result = await revokeOverride(db, text(form, "adjustmentId"));

  if (result.kind !== "ok") {
    redirect(settingsUrl({ period, error: result.reasons.join("; ") }));
  }

  revalidatePath("/", "layout");
  redirect(settingsUrl({ period, withdrawn: "1" }));
}

/**
 * v1.1.1 F4 — dashboard personalization.
 *
 * Reads the submitted form purely by widget id against the fixed catalog
 * (never by iterating arbitrary form keys), so a tampered or extra field
 * cannot introduce an unknown widget. `saveDashboardLayoutPreferences`
 * re-validates everything again before writing, so this parsing step is a
 * convenience, not the security boundary.
 */
export async function saveDashboardLayoutAction(form: FormData): Promise<void> {
  const density = text(form, "density") === "compact" ? "compact" : "expanded";

  const widgets = DASHBOARD_WIDGET_CATALOG.map((widget) => ({
    id: widget.id,
    visible: form.get(`visible_${widget.id}`) !== null,
    order: Number(text(form, `order_${widget.id}`)),
    favorite: form.get(`favorite_${widget.id}`) !== null,
  }));

  await saveDashboardLayoutPreferences(db, { density, widgets });

  revalidatePath("/", "layout");
  redirect(settingsUrl({ layoutSaved: "1" }));
}

export async function resetDashboardLayoutAction(): Promise<void> {
  await resetDashboardLayoutPreferences(db);
  revalidatePath("/", "layout");
  redirect(settingsUrl({ layoutReset: "1" }));
}
