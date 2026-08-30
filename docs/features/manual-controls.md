# Manual controls (M8)

How every financial variable becomes overridable without ever losing what
the source said. Implements `docs/02_REQUIREMENTS.md` ("Manual override
requirement"), `docs/04_USER_FLOWS.md` ("Manually override a value") and
`docs/08_DATA_TRUST_MODEL.md` ("Manual overrides interact with trust, not
bypass it").

## The shape of an override

An override is never an edit. Nothing in `plan_record`, `position_snapshot`,
`goal`, `liability` or `insurance_policy` is modified when a user changes a
figure. Instead a `manual_adjustment` row is written that names the record,
the field, and the relationship between the source value and the new one:

```
source value  +  manual adjustment  =  current value
```

Every layer works in those three terms. The engine
(`src/domain/adjustments.ts`) resolves them, the loaders
(`src/data/loaders.ts`) apply them so downstream calculations recompute, and
the Settings screen shows all three side by side — as the preview the user
confirms, as a column in the table, and as a row in the history.

Withdrawing an override restores the source value exactly, because the
source value was never touched. The withdrawn row is retained with
`revokedAt` set: that a figure was changed by hand and then changed back is
itself part of the record.

## Two modes, both stored, neither inferred

| Mode    | Means                                   | Behaviour when the source is re-imported at a new value                                   |
| ------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `set`   | "This value is ₹58,000."                | The stated figure stands, and the screen flags that the source has moved underneath it.   |
| `delta` | "Whatever the import says, add ₹1,500." | The difference re-applies to the new source value, so the correction survives the import. |

The distinction matters because both are legitimate and they behave
differently over time. Guessing which one the user meant would produce
silently wrong figures a year later; asking costs one dropdown.

A `delta` against a source with no value resolves to `insufficient-data`,
not to the delta itself: "unknown + ₹500" is not ₹500.

## What can be overridden

`src/manual/registry.ts` is the closed list. A field not declared there
cannot be overridden — an override writes to the financial record, so what
it may touch is a fixed list rather than whatever string a request carries.

| Group       | Fields                                                                                   | Covers the requirement for                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget      | `plan_record.amount`                                                                     | Take-home salary, each SIP and total investment, employee/employer PF, emergency-fund contributions, EMI plan lines, one-time income and expenses |
| Portfolio   | `position_snapshot.quantity`, `.costBasis`                                               | Stock/ETF quantities, MF units, gold and silver holdings, cost-basis corrections                                                                  |
| Goals       | `goal.targetAmount`, `goal.currentAmount`                                                | Goal targets and balances                                                                                                                         |
| Liabilities | `liability.emiAmount`, `.outstanding`, `.tenureMonths`, `liability_payer_split.shareBps` | EMI amount, end date (projected from tenure), payer split                                                                                         |
| Insurance   | `insurance_policy.coverAmount`, `.premium`                                               | Policy cover and premiums                                                                                                                         |
| Custom      | `custom_variable.value`                                                                  | Any user-defined financial variable                                                                                                               |

## Three cases that needed a decision

**A goal's balance is derived, not stored.** No goal has a current-amount
column, precisely so it cannot drift from its transactions. An override
therefore states a balance _alongside_ the derived one
(`withStatedBalance`), and deliberately does not fabricate a contribution to
explain the difference. Both figures stay on the goal card.

**Payer shares must total 100%.** `splitEmiByPayer` refuses to divide an EMI
whose shares do not sum to 10000 bps, so a lone override on one payer would
silently disable the liability's breakdown. With two payers the complement
is the only arithmetic possibility: it is computed, shown in the preview,
and written in the same transaction. With more than two payers there is no
single correct redistribution, so the engine refuses rather than choosing
one — see `docs/19_OPEN_DECISIONS.md`, D-015.

**A superseded record cannot be overridden.** Adjusting a row that a later
revision has replaced would create an override nothing applies. The preview
says so and points at the current record.

## What a preview guarantees

`previewOverride` runs every rule that could reject the override — unknown
field, unparseable entry, fractional paise, negative result, share above
100%, missing or superseded record — before anything is written, and
`applyOverride` re-runs the same function rather than trusting figures
posted back from the browser. A preview the user confirms cannot then fail
on write for a reason they were never shown, and a replayed or edited form
cannot put a number into the record that the rules would not produce now.

## Audit

Both applying and withdrawing an override write an `audit_event` of kind
`manual_override` carrying the source value, the adjustment, the resulting
value, the reason, and any companion change. `docs/16_DATA_MIGRATION.md`'s
rule that the audit log is append-only applies unchanged.
