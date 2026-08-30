# 01 — Product Vision

## What the dashboard is for

WEALTHFORGE OS exists to answer, at any time, with numbers the user can trust:

1. What do I own, owe, and have available right now?
2. What did I intend to do versus what actually happened?
3. How has my financial position changed over any selected period?
4. Am I on track for my funding goals, in priority order (emergency fund →
   car → marriage → third-floor construction)?
5. What changed, why did it change, and what action — if any — should I
   consider?

## Product principles

- **Local-first core operation.** The laptop is the primary environment; the
  app must be fully usable for core financial operations with no internet
  connection.
- **Historical honesty.** Never imply data coverage that doesn't exist. A
  period with partial or missing data is labeled as such, not silently
  treated as zero or extrapolated.
- **No silent overwrites.** A correction is a new revision, not a replacement.
- **Separate Plan, Position, and Activity.** What was intended, what is held,
  and what is confirmed to have happened are three distinct concepts that are
  never collapsed into one number without saying which one is being shown.
- **Observed change ≠ confirmed transaction.** A quantity or balance
  difference between two snapshots is a signal to investigate, not
  automatically recorded as a transaction.
- **Deterministic calculations live in domain logic**, not in the UI or the
  AI layer.
- **AI explains trusted calculations; it does not invent facts.**
- **Headline numbers are drillable** to their underlying data and provenance
  wherever practical.
- **All important assumptions are editable** by the user.
- **Milestone completion requires code + tests + audit + documentation +
  verification** — not just code that runs once.

## Who this is for

A single household managing its own finances: salary and budget tracking,
SIP/investment tracking, a home loan with a split payer structure, insurance,
and a fixed set of funding goals in priority order. Built for one user's real
financial life, not as a general-purpose multi-tenant product — see
`19_OPEN_DECISIONS.md` for what that does and doesn't rule out later.
