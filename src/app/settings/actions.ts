"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";
import { applyOverride, revokeOverride } from "../../manual/overrides";
import { findOverridableField } from "../../manual/registry";
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
