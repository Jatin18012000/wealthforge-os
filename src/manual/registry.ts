import type { AdjustmentUnit } from "../domain/adjustments";

/**
 * The closed list of overridable financial variables.
 *
 * docs/02_REQUIREMENTS.md, "Manual override requirement", names what must be
 * editable. Rather than one bespoke code path per field — which is how an
 * override screen rots until half its fields quietly stop recomputing — each
 * variable is declared once here and handled generically by
 * `src/manual/overrides.ts` and `src/data/loaders.ts`.
 *
 * A field that is not in this table cannot be overridden. That is deliberate:
 * an override writes to the financial record, so the set of things it can
 * touch is a closed list, not whatever string a request happens to carry.
 */

export interface OverridableField {
  /** Matches the database table the value comes from. */
  readonly entityType: string;
  readonly field: string;
  readonly label: string;
  readonly unit: AdjustmentUnit;
  /** Which Settings group this appears under. */
  readonly group: OverrideGroup;
  /**
   * False where a difference makes no sense because the field has no
   * imported source to differ from (a user-defined variable, a goal balance
   * derived from activity).
   */
  readonly allowsDelta: boolean;
  /** Shown beside the field so the user knows what they are changing. */
  readonly help: string;
}

export type OverrideGroup =
  "Budget" | "Portfolio" | "Goals" | "Liabilities" | "Insurance" | "Custom";

export const OVERRIDABLE_FIELDS: readonly OverridableField[] = [
  {
    entityType: "plan_record",
    field: "amount",
    label: "Planned amount",
    unit: "money",
    group: "Budget",
    allowsDelta: true,
    help: "Covers every budget line: take-home salary, each SIP, employee and employer PF, emergency-fund contributions, EMI plan lines, and one-time income or expenses.",
  },
  {
    entityType: "position_snapshot",
    field: "quantity",
    label: "Quantity held",
    unit: "quantity",
    group: "Portfolio",
    allowsDelta: true,
    help: "Shares, units or grams. Corrects a holding the broker statement got wrong, or records gold and silver the statement never covered.",
  },
  {
    entityType: "position_snapshot",
    field: "costBasis",
    label: "Cost basis",
    unit: "money",
    group: "Portfolio",
    allowsDelta: true,
    help: "Total acquisition cost of the holding. Without one, profit and loss reports insufficient data rather than inferring a cost from a later price.",
  },
  {
    entityType: "goal",
    field: "targetAmount",
    label: "Target amount",
    unit: "money",
    group: "Goals",
    allowsDelta: true,
    help: "What the goal is aiming at.",
  },
  {
    entityType: "goal",
    field: "currentAmount",
    label: "Current balance",
    unit: "money",
    group: "Goals",
    allowsDelta: false,
    help: "The balance is normally derived from this goal's contribution and withdrawal history. An override states a different balance without inventing a transaction to explain it — both figures stay visible.",
  },
  {
    entityType: "liability",
    field: "emiAmount",
    label: "EMI amount",
    unit: "money",
    group: "Liabilities",
    allowsDelta: true,
    help: "The monthly instalment.",
  },
  {
    entityType: "liability",
    field: "outstanding",
    label: "Outstanding balance",
    unit: "money",
    group: "Liabilities",
    allowsDelta: true,
    help: "Principal still owed, as of the recorded date.",
  },
  {
    entityType: "liability",
    field: "tenureMonths",
    label: "Remaining tenure (months)",
    unit: "count",
    group: "Liabilities",
    allowsDelta: true,
    help: "The loan's end date is projected from the tenure rather than stored separately, so correcting the tenure moves the projected final payment.",
  },
  {
    entityType: "liability_payer_split",
    field: "shareBps",
    label: "Payer share",
    unit: "bps",
    group: "Liabilities",
    allowsDelta: true,
    help: "Basis points of the EMI this payer covers — 10000 is the whole instalment. The shares for one liability must still sum to exactly 10000 after the override.",
  },
  {
    entityType: "insurance_policy",
    field: "coverAmount",
    label: "Cover amount",
    unit: "money",
    group: "Insurance",
    allowsDelta: true,
    help: "Sum insured.",
  },
  {
    entityType: "insurance_policy",
    field: "premium",
    label: "Premium",
    unit: "money",
    group: "Insurance",
    allowsDelta: true,
    help: "Premium per the policy's own frequency.",
  },
  {
    entityType: "custom_variable",
    field: "value",
    label: "Custom variable",
    unit: "money",
    group: "Custom",
    allowsDelta: false,
    help: "A user-defined financial variable that no import provides. It has no source value, so the entered figure is the whole of it.",
  },
];

const BY_KEY = new Map(
  OVERRIDABLE_FIELDS.map((field) => [`${field.entityType}|${field.field}`, field]),
);

/** Looks up a declared field, or undefined if the request names one that is not overridable. */
export function findOverridableField(
  entityType: string,
  field: string,
): OverridableField | undefined {
  return BY_KEY.get(`${entityType}|${field}`);
}

export const OVERRIDE_GROUPS: readonly OverrideGroup[] = [
  "Budget",
  "Portfolio",
  "Goals",
  "Liabilities",
  "Insurance",
  "Custom",
];

/** Basis points of the whole: payer splits for one liability must sum to this. */
export const WHOLE_IN_BPS = 10_000;
