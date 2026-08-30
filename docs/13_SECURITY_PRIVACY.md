# 13 — Security & Privacy

## Posture

Local storage plus normal device security. This is a single-user, local
application — it deliberately does not add application-level authentication
or session infrastructure unless a genuine multi-user or remote-access
requirement is later approved (that would be a recorded decision, not a
default). Security effort is proportional to actual risk: protecting real
financial data at rest and in transit to any external service it explicitly
talks to, without inventing enterprise auth machinery this product doesn't
need.

## Secrets

- No hardcoded secrets anywhere in source. All provider keys/tokens are read
  from environment variables, documented (with placeholder values only) in
  `.env.example`.
- Brokerage/market-data API keys are never committed, never logged, and
  never included in any error message or stack trace surfaced to the UI.
- `.env` is gitignored; CI/local tooling must never print its contents.

## File handling

- Uploaded workbook files are validated before parsing (file type, size
  limits) and parsed with a library that only reads cell values — no
  execution of embedded formulas as code, no macro execution.
- Uploaded file storage path is not user-controllable (no path traversal via
  a supplied filename).

## Data at rest

- The SQLite database file and any raw uploaded file blobs live under
  `data/`, which is gitignored. Real financial data is never committed to
  source control, including in test fixtures — fixtures use synthetic data
  only (`19_OPEN_DECISIONS.md`, `tests/fixtures/`).
- Backups (`16_DATA_MIGRATION.md`) are plain local files by default; if
  encryption-at-rest for backups is desired, that's a user-facing option
  documented there, not assumed here.

## Data in transit

- Core app: no network calls required for core financial operations.
- Optional market data fetch and optional cloud AI provider calls happen
  over HTTPS only, and only when explicitly configured
  (`.env.example` — providers are opt-in, not defaulted to a cloud service).

## Input validation

All user input and all imported file content is validated before reaching
the domain layer (`08_DATA_TRUST_MODEL.md` validation checks; OWASP-aligned
input handling for anything reaching a UI form or API route).

## Logging

Application logs must never contain: full financial figures beyond what's
necessary for debugging a specific failure, API keys/tokens, or raw
uploaded file contents. Prefer logging record IDs and classification
outcomes over raw values.

## Read-only integrations

Any future brokerage integration (Zerodha/Kite) or MF data source (Groww)
must be read-only. No integration may execute trades. See
`21` in the source build plan and `19_OPEN_DECISIONS.md` for what remains
undecided about these integrations.
