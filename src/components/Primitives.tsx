import type { ReactNode } from "react";
import type { Computed, Exclusion } from "../domain";
import {
  formatMoney,
  formatPriceAge,
  formatRatio,
  formatTrustState,
} from "../presentation/format";

/**
 * Display primitives.
 *
 * These exist to make the engine's honesty visible rather than to decorate:
 * an insufficient-data result must read as an explained absence, an excluded
 * record must be nameable, and a dated price must never look live.
 */

export function Card({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="card">
      {title !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="card__title">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Renders a `Computed<T>` — a value, or the reasons it could not be produced.
 *
 * Every headline figure on every screen goes through this, which is what
 * stops "Insufficient data" being quietly rendered as ₹0 anywhere in the UI.
 */
export function Computed$<T>({
  result,
  children,
  showReasons = true,
}: {
  result: Computed<T>;
  children: (value: T) => ReactNode;
  showReasons?: boolean;
}) {
  if (result.kind === "ok") return <>{children(result.value)}</>;
  return <InsufficientData reasons={showReasons ? result.reasons : []} />;
}

export function InsufficientData({ reasons }: { reasons: readonly string[] }) {
  return (
    <div>
      <span className="insufficient">Insufficient data</span>
      {reasons.length > 0 && (
        <ul className="insufficient__reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatTile({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? " tile__value--positive"
      : tone === "negative"
        ? " tile__value--negative"
        : "";

  return (
    <section className="card">
      <h3 className="tile__label">{label}</h3>
      <p className={`tile__value${toneClass}`}>{value}</p>
      {note !== undefined && <p className="tile__note">{note}</p>}
    </section>
  );
}

/** A money tile whose tone follows the sign of the amount. */
export function MoneyTile({
  label,
  minorUnits,
  note,
  signed = false,
}: {
  label: string;
  minorUnits: number;
  note?: ReactNode;
  signed?: boolean;
}) {
  return (
    <StatTile
      label={label}
      value={formatMoney(minorUnits)}
      note={note}
      tone={signed ? (minorUnits > 0 ? "positive" : minorUnits < 0 ? "negative" : "neutral") : "neutral"}
    />
  );
}

export function TrustBadge({ trustState }: { trustState: string }) {
  if (trustState === "validated" || trustState === "verified") return null;
  return <span className="badge badge--caution">{formatTrustState(trustState)}</span>;
}

/**
 * States a price's age in words. Deliberately never renders "live" — the
 * app reads dated closing prices, and implying otherwise is the exact
 * misrepresentation docs/18_FAILURE_MODES.md warns about.
 */
export function FreshnessNote({ days, asOf }: { days: number; asOf: Date }) {
  const label = formatPriceAge(days);
  return (
    <span className={days > 7 ? "badge badge--caution" : "badge badge--muted"}>
      {label} · priced {asOf.toISOString().slice(0, 10)}
    </span>
  );
}

/**
 * Names what was left out of a total and why.
 *
 * A total that silently omits records is worse than one that explains
 * itself, so every screen that shows a sum shows this beside it.
 */
export function ExclusionList({ exclusions }: { exclusions: readonly Exclusion[] }) {
  if (exclusions.length === 0) return null;
  return (
    <details style={{ marginTop: "0.6rem" }}>
      <summary className="note" style={{ cursor: "pointer" }}>
        {exclusions.length} record{exclusions.length === 1 ? "" : "s"} excluded from this total
      </summary>
      <ul className="insufficient__reasons">
        {exclusions.map((exclusion) => (
          <li key={exclusion.recordId}>
            <strong>{exclusion.label}</strong> — {exclusion.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ProgressBar({ ratio, label }: { ratio: number; label: string }) {
  const clamped = Math.max(0, Math.min(ratio, 1));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`progress__fill${ratio >= 1 ? " progress__fill--complete" : ""}`}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

export function RatioText({ ratio }: { ratio: number }) {
  return <span>{formatRatio(ratio)}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
