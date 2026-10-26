import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import styles from './Charts.module.css';

const share = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : '—';

export interface BarRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Where the bar leads, e.g. the collection filtered to this genre. */
  readonly to?: string;
}

/**
 * Ranked horizontal bars, one series: value at each bar's tip, the share of
 * the whole in a tooltip on hover and keyboard focus.
 */
export function BarList({
  rows,
  total,
  unit,
  label,
}: {
  readonly rows: readonly BarRow[];
  /** What shares are computed against (e.g. all releases). */
  readonly total: number;
  readonly unit: [singular: string, plural: string];
  /** Accessible name of the list. */
  readonly label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className={styles.bars} aria-label={label}>
      {rows.map((row) => {
        const text = `${row.value.toLocaleString('en')} ${row.value === 1 ? unit[0] : unit[1]}`;
        const body = (
          <>
            <span className={styles.barLabel}>{row.label}</span>
            <span className={styles.track}>
              <span
                className={styles.bar}
                style={{ '--size': `${(row.value / max) * 100}%` } as CSSProperties}
              />
              <span className={`mono ${styles.value}`}>{row.value.toLocaleString('en')}</span>
            </span>
            <span className={styles.tip} role="presentation">
              <strong>{text}</strong> {share(row.value, total)} of {total.toLocaleString('en')}
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {row.to ? (
              <Link className={styles.row} to={row.to} aria-label={`${row.label}: ${text}`}>
                {body}
              </Link>
            ) : (
              <span
                className={styles.row}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: focus shows the same tooltip as hover
                tabIndex={0}
              >
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface Column {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/** Round tick steps: 1, 2, 5 × 10ⁿ, about four ticks up to the maximum. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step - 1e-9; t += step) ticks.push(t);
  return ticks;
}

/**
 * Columns over an ordered category (decades). Only the tallest column is
 * labelled; the axis, tooltips and the table view carry the rest.
 */
export function ColumnChart({
  columns,
  unit,
  label,
}: {
  readonly columns: readonly Column[];
  readonly unit: [singular: string, plural: string];
  readonly label: string;
}) {
  const ticks = niceTicks(Math.max(0, ...columns.map((c) => c.value)));
  const top = ticks.at(-1) || 1;
  const peak = Math.max(...columns.map((c) => c.value));
  const total = columns.reduce((sum, c) => sum + c.value, 0);
  const text = (c: Column) => `${c.value} ${c.value === 1 ? unit[0] : unit[1]}`;
  return (
    <figure className={styles.columnFigure}>
      <div className={styles.plot}>
        <div className={styles.grid} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className={styles.gridline} style={{ bottom: `${(t / top) * 100}%` }}>
              <span className="mono">{t}</span>
            </span>
          ))}
        </div>
        <ol className={styles.columns} aria-label={label}>
          {columns.map((c) => (
            <li key={c.key} className={styles.columnSlot}>
              <span
                className={styles.column}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: focus shows the same tooltip as hover
                tabIndex={0}
                role="img"
                aria-label={`${c.label}: ${text(c)}`}
              >
                <span
                  className={styles.columnBar}
                  style={{ height: `${(c.value / top) * 100}%` }}
                />
                {c.value === peak && (
                  <span
                    className={`mono ${styles.cap}`}
                    style={{ bottom: `${(c.value / top) * 100}%` }}
                    aria-hidden="true"
                  >
                    {c.value}
                  </span>
                )}
                <span
                  className={styles.tip}
                  role="presentation"
                  style={{ bottom: `calc(${(c.value / top) * 100}% + 24px)` }}
                >
                  <strong>{text(c)}</strong> {c.label} · {share(c.value, total)}
                </span>
              </span>
              <span className={`mono ${styles.columnLabel}`} aria-hidden="true">
                {c.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <details className={styles.tableView}>
        <summary>Show as a table</summary>
        <table>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key}>
                <th scope="row">{c.label}</th>
                <td className="mono">{c.value}</td>
                <td className="mono">{share(c.value, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export interface Segment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** A CSS color for the mark (never used for text). */
  readonly color: string;
}

/**
 * Part-to-whole in one bar, segments split by a 2 px surface gap. The legend
 * lists every segment with its count and share, so it doubles as the table.
 */
export function StackedBar({
  segments,
  unit,
  label,
}: {
  readonly segments: readonly Segment[];
  readonly unit: [singular: string, plural: string];
  readonly label: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const text = (s: Segment) => `${s.value} ${s.value === 1 ? unit[0] : unit[1]}`;
  return (
    <figure className={styles.stackFigure} aria-label={label}>
      <div className={styles.stack}>
        {segments.map((s) => (
          <span
            key={s.key}
            className={styles.segment}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focus shows the same tooltip as hover
            tabIndex={0}
            role="img"
            style={{ flexGrow: s.value, background: s.color }}
            aria-label={`${s.label}: ${text(s)}`}
          >
            <span className={styles.tip} role="presentation">
              <strong>{text(s)}</strong> {s.label} · {share(s.value, total)}
            </span>
          </span>
        ))}
      </div>
      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.key}>
            <span className={styles.swatch} style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="mono">
              {s.value} · {share(s.value, total)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
