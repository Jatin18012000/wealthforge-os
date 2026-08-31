import { Card, EmptyState, StatTile } from "../../components/Primitives";
import { db } from "../../lib/db";
import { formatDate, formatMoney } from "../../presentation/format";
import { getInsuranceView } from "../../views/insuranceView";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  health_personal: "Health — personal",
  health_family: "Health — family",
  term: "Term",
  other: "Other",
};

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: "/month",
  quarterly: "/quarter",
  annual: "/year",
};

export default async function InsurancePage() {
  const view = await getInsuranceView(db);

  return (
    <>
      <div className="page-header">
        <h1>Insurance</h1>
        <p>Coverage, premiums and term-insurance status.</p>
      </div>

      <div className="stack">
        <div className="grid grid--tiles">
          <StatTile
            label="Total active cover"
            value={formatMoney(view.totalCoverMinorUnits)}
            note={`${view.policies.filter((p) => p.status === "active").length} active polic${view.policies.filter((p) => p.status === "active").length === 1 ? "y" : "ies"}`}
          />
          <StatTile
            label="Term insurance"
            value={view.hasActiveTermCover ? "In force" : "Gap — not yet in force"}
            note={
              view.hasActiveTermCover
                ? undefined
                : "Planned, per docs/02_REQUIREMENTS.md — no term policy is currently active"
            }
          />
        </div>

        {view.policies.length === 0 ? (
          <Card>
            <EmptyState>No insurance policies recorded.</EmptyState>
          </Card>
        ) : (
          <Card title="Policies">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Insured</th>
                    <th scope="col">Provider</th>
                    <th scope="col" className="num">
                      Cover
                    </th>
                    <th scope="col" className="num">
                      Premium
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Effective from</th>
                  </tr>
                </thead>
                <tbody>
                  {view.policies.map((policy) => (
                    <tr key={policy.id}>
                      <td>{KIND_LABELS[policy.kind] ?? policy.kind}</td>
                      <td>{policy.insuredParty}</td>
                      <td>{policy.provider}</td>
                      <td className="num">
                        {policy.coverAmountMinorUnits === null ? (
                          <span className="note">Not recorded</span>
                        ) : (
                          formatMoney(policy.coverAmountMinorUnits)
                        )}
                      </td>
                      <td className="num">
                        {policy.premiumMinorUnits === null ? (
                          <span className="note">Not recorded</span>
                        ) : (
                          <>
                            {formatMoney(policy.premiumMinorUnits)}
                            {policy.premiumFrequency !== null
                              ? (FREQUENCY_LABELS[policy.premiumFrequency] ?? "")
                              : ""}
                          </>
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            policy.status === "active"
                              ? "badge badge--muted"
                              : "badge badge--caution"
                          }
                        >
                          {policy.status}
                        </span>
                      </td>
                      <td>
                        {policy.effectiveFrom === null
                          ? "—"
                          : formatDate(policy.effectiveFrom)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
