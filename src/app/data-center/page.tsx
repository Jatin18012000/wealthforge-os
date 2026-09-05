import { Card, EmptyState } from "../../components/Primitives";
import { ensureAutomaticBackup } from "../../backup";
import { BACKUP_DIR } from "../../data/dataCenterStore";
import { db } from "../../lib/db";
import { formatDate, formatMoney } from "../../presentation/format";
import { getDataCenterView } from "../../views/dataCenterView";
import {
  closeGoalAction,
  closeInsurancePolicyAction,
  closeLiabilityAction,
  createGoalAction,
  createInsurancePolicyAction,
  createLiabilityAction,
  deleteGoalAction,
  deleteInsurancePolicyAction,
  deleteLiabilityAction,
  exportBackupAction,
  restoreBackupAction,
  uploadBudgetWorkbookAction,
  uploadPortfolioSnapshotAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Data Center — imports, revisions, provenance, trust states, the audit
 * log, and backup/restore (`docs/03_INFORMATION_ARCHITECTURE.md`).
 *
 * This is the one screen that runs the real ingestion pipeline from a
 * browser upload rather than a script, and the one screen that can
 * overwrite the live database (restore) — both get the same two-step
 * caution as Settings: nothing destructive happens without the conflict
 * or confirmation step being shown first.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_ASSET_CLASSES = [
  { value: "", label: "Statement states its own asset class" },
  { value: "equity", label: "Equity" },
  { value: "etf", label: "ETF" },
  { value: "mutual_fund", label: "Mutual fund" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
  { value: "epf", label: "EPF" },
] as const;

const GOAL_KIND_OPTIONS = [
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "car", label: "Car" },
  { value: "marriage", label: "Marriage" },
  { value: "third_floor", label: "Third floor" },
  { value: "custom", label: "Custom" },
] as const;

const LIABILITY_KIND_OPTIONS = [
  { value: "home_loan", label: "Home loan" },
  { value: "other", label: "Other (card, gadget, personal loan, ...)" },
] as const;

const INSURANCE_KIND_OPTIONS = [
  { value: "health_personal", label: "Health — personal" },
  { value: "health_family", label: "Health — family" },
  { value: "term", label: "Term" },
  { value: "other", label: "Other" },
] as const;

const PREMIUM_FREQUENCY_OPTIONS = [
  { value: "", label: "Not yet known" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
] as const;

export default async function DataCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  // The closest local-first analogue of "on startup, if due" for a server
  // that has no background process of its own — see src/backup/autoBackup.ts.
  const autoBackup = await ensureAutomaticBackup(db, BACKUP_DIR);

  const view = await getDataCenterView(db, {
    ...(one("event") === "" ? {} : { highlightEventId: one("event") }),
  });

  const [goals, liabilities, insurancePolicies] = await Promise.all([
    db.goal.findMany({ orderBy: { priorityRank: "asc" } }),
    db.liability.findMany({ orderBy: { createdAt: "asc" } }),
    db.insurancePolicy.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const error = one("error");
  const conflictBackup = one("conflictBackup");
  const currentYear = new Date().getUTCFullYear();

  return (
    <>
      <div className="page-header">
        <h1>Data Center</h1>
        <p>
          Every upload runs the same ingestion pipeline the tests run — nothing is faked
          for the screen. Backups are automatic (
          {autoBackup.ranBackup
            ? "one was just taken"
            : `next due ${formatDate(autoBackup.nextDueAt)}`}
          ) and manual export/restore are below.
        </p>
      </div>

      <div className="stack">
        {error !== "" && (
          <p className="alert alert--caution">
            <span className="alert__title">Nothing was changed.</span> {error}
          </p>
        )}

        {view.justPerformed !== null && (
          <Card title="Import Audit">
            <p>{view.justPerformed.summary}</p>
            <p className="note">
              Recorded {formatDate(view.justPerformed.createdAt)} as audit_event{" "}
              {view.justPerformed.id}. A backup was taken automatically right after this
              import.
            </p>
          </Card>
        )}

        {one("backedUp") !== "" && (
          <p className="alert">
            <span className="alert__title">Backup written.</span> It now appears in the
            list below.
          </p>
        )}
        {one("restored") !== "" && (
          <p className="alert">
            <span className="alert__title">Restore complete.</span> A safety backup of the
            state before this restore was taken at {one("safetyBackup")}.
          </p>
        )}
        {one("recordCreated") !== "" && (
          <p className="alert">
            <span className="alert__title">Created.</span> {one("recordCreated")}
          </p>
        )}
        {one("recordClosed") !== "" && (
          <p className="alert">
            <span className="alert__title">Closed.</span> &quot;{one("recordClosed")}&quot;
            is kept on the record but no longer counted as active.
          </p>
        )}
        {one("recordDeleted") !== "" && (
          <p className="alert">
            <span className="alert__title">Deleted.</span> &quot;{one("recordDeleted")}&quot;
            had no recorded history, so it was removed outright.
          </p>
        )}
        {conflictBackup !== "" && (
          <Card title="Restore blocked">
            <p className="alert alert--caution">
              <span className="alert__title">
                The live database has newer data than this backup.
              </span>{" "}
              {one("conflictReason")}
            </p>
            <p className="note">
              A safety backup of the current state was still taken at{" "}
              {one("safetyBackup")}, so nothing is at risk either way.
            </p>
            <form action={restoreBackupAction} className="entry-form">
              <input type="hidden" name="backupPath" value={conflictBackup} />
              <input type="hidden" name="force" value="1" />
              <button type="submit" className="button button--primary">
                Restore anyway, discarding the newer data
              </button>
            </form>
          </Card>
        )}

        <Card title="Import a budget workbook">
          <p className="note">
            Re-reads the entire workbook every time — corrections become revisions,
            nothing is silently overwritten.
          </p>
          <form action={uploadBudgetWorkbookAction} className="entry-form">
            <label className="field">
              <span className="field__label">Workbook (.xlsx)</span>
              <input
                className="field__input"
                type="file"
                name="file"
                accept=".xlsx"
                required
                aria-label="Budget workbook file"
              />
            </label>
            <label className="field">
              <span className="field__label">Default year</span>
              <input
                className="field__input"
                type="number"
                name="defaultYear"
                defaultValue={currentYear}
                aria-label="Default year for bare month sheet names"
              />
            </label>
            <button type="submit" className="button button--primary">
              Upload and import
            </button>
          </form>
        </Card>

        <Card title="Import a portfolio snapshot">
          <p className="note">
            A snapshot is a position at a date, not a transaction. Zerodha statements
            carry their own date; other layouts need one supplied.
          </p>
          <form action={uploadPortfolioSnapshotAction} className="entry-form">
            <label className="field">
              <span className="field__label">Snapshot (.xlsx or .csv)</span>
              <input
                className="field__input"
                type="file"
                name="file"
                accept=".xlsx,.csv"
                required
                aria-label="Portfolio snapshot file"
              />
            </label>
            <label className="field">
              <span className="field__label">As-of date (if the file needs one)</span>
              <input
                className="field__input"
                type="date"
                name="asOf"
                aria-label="As-of date"
              />
            </label>
            <label className="field">
              <span className="field__label">Asset class (if the file needs one)</span>
              <select className="field__select" name="assetClass" defaultValue="">
                {DEFAULT_ASSET_CLASSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button button--primary">
              Upload and import
            </button>
          </form>
        </Card>

        <Card title="Register a new goal">
          <p className="note" style={{ marginBottom: "0.6rem" }}>
            Once registered, its balance is tracked the same way every goal&apos;s is — as
            a running sum of contributions, never a separately-stored total. Top it up from
            the Goals screen.
          </p>
          <form action={createGoalAction} className="entry-form">
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__input"
                type="text"
                name="name"
                placeholder="e.g. Vacation fund"
                required
                aria-label="Goal name"
              />
            </label>
            <label className="field">
              <span className="field__label">Type</span>
              <select className="field__select" name="kind" defaultValue="custom">
                {GOAL_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Target amount (₹)</span>
              <input
                className="field__input"
                type="text"
                name="targetAmount"
                inputMode="decimal"
                placeholder="e.g. 200000"
                required
                aria-label="Goal target amount"
              />
            </label>
            <label className="field">
              <span className="field__label">Target date (optional)</span>
              <input className="field__input" type="date" name="targetDate" aria-label="Goal target date" />
            </label>
            <button type="submit" className="button button--primary">
              Register goal
            </button>
          </form>
        </Card>

        <Card title="Register a new EMI / liability">
          <p className="note" style={{ marginBottom: "0.6rem" }}>
            Give the total price and what you paid upfront — the system finances the rest:
            principal = price − upfront, and the monthly EMI is calculated from the
            principal, the interest rate, and the number of months between the start and
            end date (0% interest is a valid, flat EMI).
          </p>
          <form action={createLiabilityAction} className="entry-form">
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__input"
                type="text"
                name="name"
                placeholder="e.g. New phone EMI"
                required
                aria-label="Liability name"
              />
            </label>
            <label className="field">
              <span className="field__label">Type</span>
              <select className="field__select" name="kind" defaultValue="other">
                {LIABILITY_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Total price (₹)</span>
              <input
                className="field__input"
                type="text"
                name="totalPrice"
                inputMode="decimal"
                placeholder="e.g. 60000"
                required
                aria-label="Total price"
              />
            </label>
            <label className="field">
              <span className="field__label">Amount paid upfront (₹)</span>
              <input
                className="field__input"
                type="text"
                name="amountPaidUpfront"
                inputMode="decimal"
                placeholder="e.g. 0"
                aria-label="Amount paid upfront"
              />
            </label>
            <label className="field">
              <span className="field__label">Start date</span>
              <input className="field__input" type="date" name="startDate" required aria-label="EMI start date" />
            </label>
            <label className="field">
              <span className="field__label">End date</span>
              <input className="field__input" type="date" name="endDate" required aria-label="EMI end date" />
            </label>
            <label className="field">
              <span className="field__label">Annual interest rate (%)</span>
              <input
                className="field__input"
                type="text"
                name="annualInterestRate"
                inputMode="decimal"
                placeholder="e.g. 0 for a no-cost EMI"
                aria-label="Annual interest rate percent"
              />
            </label>
            <button type="submit" className="button button--primary">
              Register liability
            </button>
          </form>
        </Card>

        <Card title="Register a new insurance policy">
          <form action={createInsurancePolicyAction} className="entry-form">
            <label className="field">
              <span className="field__label">Type</span>
              <select className="field__select" name="kind" defaultValue="other">
                {INSURANCE_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Insured party</span>
              <input
                className="field__input"
                type="text"
                name="insuredParty"
                placeholder="e.g. Self, Family"
                required
                aria-label="Insured party"
              />
            </label>
            <label className="field">
              <span className="field__label">Provider</span>
              <input
                className="field__input"
                type="text"
                name="provider"
                placeholder="e.g. HDFC Life"
                required
                aria-label="Insurance provider"
              />
            </label>
            <label className="field">
              <span className="field__label">Cover amount (₹, optional)</span>
              <input
                className="field__input"
                type="text"
                name="coverAmount"
                inputMode="decimal"
                aria-label="Cover amount"
              />
            </label>
            <label className="field">
              <span className="field__label">Premium (₹, optional)</span>
              <input className="field__input" type="text" name="premium" inputMode="decimal" aria-label="Premium" />
            </label>
            <label className="field">
              <span className="field__label">Premium frequency</span>
              <select className="field__select" name="premiumFrequency" defaultValue="">
                {PREMIUM_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Effective from (optional)</span>
              <input
                className="field__input"
                type="date"
                name="effectiveFrom"
                aria-label="Policy effective from"
              />
            </label>
            <button type="submit" className="button button--primary">
              Register policy
            </button>
          </form>
        </Card>

        <Card title="Manage records">
          <p className="note" style={{ marginBottom: "0.6rem" }}>
            Closing keeps a record and its full history on file, just no longer counted as
            active. Deleting is only available while a record has no recorded
            payment/contribution history — once it does, close it instead.
          </p>

          <h3 className="card__title">Goals</h3>
          {goals.length === 0 ? (
            <EmptyState>No goals registered.</EmptyState>
          ) : (
            <div className="table-scroll" style={{ marginBottom: "1rem" }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">State</th>
                    <th scope="col">Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map((goal) => (
                    <tr key={goal.id}>
                      <td>{goal.name}</td>
                      <td>{goal.lifecycleState.replace(/_/g, " ")}</td>
                      <td>
                        {goal.lifecycleState !== "cancelled" && (
                          <form action={closeGoalAction} style={{ display: "inline-block", marginRight: "0.4rem" }}>
                            <input type="hidden" name="goalId" value={goal.id} />
                            <button type="submit" className="button button--quiet">
                              Close
                            </button>
                          </form>
                        )}
                        <form action={deleteGoalAction} style={{ display: "inline-block" }}>
                          <input type="hidden" name="goalId" value={goal.id} />
                          <button type="submit" className="button button--quiet">
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="card__title">Liabilities / EMIs</h3>
          {liabilities.length === 0 ? (
            <EmptyState>No liabilities registered.</EmptyState>
          ) : (
            <div className="table-scroll" style={{ marginBottom: "1rem" }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col" className="num">
                      EMI
                    </th>
                    <th scope="col">State</th>
                    <th scope="col">Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {liabilities.map((liability) => (
                    <tr key={liability.id}>
                      <td>{liability.name}</td>
                      <td className="num">{formatMoney(liability.emiAmountMinorUnits)}/mo</td>
                      <td>{liability.closedAt === null ? "active" : `closed ${formatDate(liability.closedAt)}`}</td>
                      <td>
                        {liability.closedAt === null && (
                          <form
                            action={closeLiabilityAction}
                            style={{ display: "inline-block", marginRight: "0.4rem" }}
                          >
                            <input type="hidden" name="liabilityId" value={liability.id} />
                            <button type="submit" className="button button--quiet">
                              Close
                            </button>
                          </form>
                        )}
                        <form action={deleteLiabilityAction} style={{ display: "inline-block" }}>
                          <input type="hidden" name="liabilityId" value={liability.id} />
                          <button type="submit" className="button button--quiet">
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="card__title">Insurance policies</h3>
          {insurancePolicies.length === 0 ? (
            <EmptyState>No insurance policies registered.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Insured</th>
                    <th scope="col">Status</th>
                    <th scope="col">Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {insurancePolicies.map((policy) => (
                    <tr key={policy.id}>
                      <td>{policy.provider}</td>
                      <td>{policy.insuredParty}</td>
                      <td>{policy.status}</td>
                      <td>
                        {policy.status !== "cancelled" && (
                          <form
                            action={closeInsurancePolicyAction}
                            style={{ display: "inline-block", marginRight: "0.4rem" }}
                          >
                            <input type="hidden" name="policyId" value={policy.id} />
                            <button type="submit" className="button button--quiet">
                              Close
                            </button>
                          </form>
                        )}
                        <form action={deleteInsurancePolicyAction} style={{ display: "inline-block" }}>
                          <input type="hidden" name="policyId" value={policy.id} />
                          <button type="submit" className="button button--quiet">
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Backup & restore">
          <form action={exportBackupAction} style={{ marginBottom: "0.8rem" }}>
            <button type="submit" className="button">
              Export a backup now
            </button>
          </form>

          {view.backups.length === 0 ? (
            <EmptyState>No backups yet.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Taken</th>
                    <th scope="col" className="num">
                      Size
                    </th>
                    <th scope="col">Restore</th>
                  </tr>
                </thead>
                <tbody>
                  {view.backups.map((backup) => (
                    <tr key={backup.path}>
                      <td>{backup.fileName}</td>
                      <td>{formatDate(backup.createdAt)}</td>
                      <td className="num">{formatBytes(backup.sizeBytes)}</td>
                      <td>
                        <form action={restoreBackupAction}>
                          <input type="hidden" name="backupPath" value={backup.path} />
                          <button type="submit" className="button button--quiet">
                            Restore this backup
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="note" style={{ marginTop: "0.6rem" }}>
            Restoring always takes a safety backup of the current state first, and refuses
            to overwrite data newer than the backup being restored unless confirmed.
          </p>
        </Card>

        <Card title="Provenance — uploaded documents">
          {view.sourceDocuments.length === 0 ? (
            <EmptyState>Nothing has been imported yet.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Uploaded</th>
                    <th scope="col" className="num">
                      Sheets
                    </th>
                    <th scope="col" className="num">
                      Budget lines
                    </th>
                    <th scope="col" className="num">
                      Positions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.sourceDocuments.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        {doc.fileName}
                        <br />
                        <span className="note">{doc.fileHash.slice(0, 12)}…</span>
                      </td>
                      <td>{doc.kind}</td>
                      <td>{formatDate(doc.uploadedAt)}</td>
                      <td className="num">{doc.sheetCount}</td>
                      <td className="num">{doc.planRecordCount}</td>
                      <td className="num">{doc.positionSnapshotCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Trust states">
          <p className="note">
            Only Validated and Verified records count toward headline totals; everything
            else stays visible here until resolved.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Records</th>
                  <th scope="col" className="num">
                    Extracted
                  </th>
                  <th scope="col" className="num">
                    Needs review
                  </th>
                  <th scope="col" className="num">
                    Validated
                  </th>
                  <th scope="col" className="num">
                    Verified
                  </th>
                  <th scope="col" className="num">
                    Rejected
                  </th>
                  <th scope="col" className="num">
                    Superseded
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.trustSummaries.map((summary) => (
                  <tr key={summary.entityType}>
                    <td>{summary.label}</td>
                    <td className="num">{summary.counts.extracted}</td>
                    <td className="num">{summary.counts.needs_review}</td>
                    <td className="num">{summary.counts.validated}</td>
                    <td className="num">{summary.counts.verified}</td>
                    <td className="num">{summary.counts.rejected}</td>
                    <td className="num">{summary.counts.superseded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Revisions">
          {view.revisions.length === 0 ? (
            <EmptyState>No record has been revised yet.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Record</th>
                    <th scope="col">Source</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {view.revisions.map((revision) => (
                    <tr key={revision.id}>
                      <td>{formatDate(revision.createdAt)}</td>
                      <td>
                        {revision.entityType}
                        <br />
                        <span className="note">{revision.entityId}</span>
                      </td>
                      <td>{revision.source}</td>
                      <td>{revision.reason ?? <span className="note">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Audit log">
          {view.auditLog.length === 0 ? (
            <EmptyState>Nothing has happened yet.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Kind</th>
                    <th scope="col">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {view.auditLog.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDate(event.createdAt)}</td>
                      <td>
                        <span className="badge badge--muted">{event.kind}</span>
                      </td>
                      <td>{event.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
