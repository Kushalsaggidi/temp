import type { ReactNode } from "react";

export type ChartTone = "positive" | "warning" | "negative" | "neutral" | "brand";

export interface BarDatum {
  label: string;
  value: number;
  tone?: ChartTone;
  /** Optional secondary value shown in the table view only. */
  note?: string;
}

/**
 * Horizontal bar chart for category comparison and ranking.
 *
 * The mark is a CSS bar: capped thickness, a 4px rounded data-end, square at the
 * baseline, growing from a single baseline. Values are direct-labelled at the tip
 * and a table view carries every value, which is also the relief required for the
 * amber mark's sub-3:1 contrast.
 */
export function BarChart({
  data,
  caption,
  tableLabel = "Category",
  valueLabel = "Count",
  emptyMessage = "No data recorded yet.",
}: {
  data: BarDatum[];
  caption: string;
  tableLabel?: string;
  valueLabel?: string;
  emptyMessage?: string;
}) {
  const max = Math.max(...data.map((item) => item.value), 1);

  if (data.length === 0) {
    return (
      <figure className="chart">
        <p className="t-small">{emptyMessage}</p>
        <figcaption className="chart__caption">{caption}</figcaption>
      </figure>
    );
  }

  return (
    <figure className="chart">
      <ul className="bars" role="list">
        {data.map((item) => (
          <li className="bars__row" key={item.label}>
            <span className="bars__label">{item.label}</span>
            <span className="bars__track">
              <span
                className={`bars__bar bars__bar--${item.tone ?? "brand"}`}
                style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0)}%` }}
              />
            </span>
            <span className="bars__value t-num">{item.value}</span>
          </li>
        ))}
      </ul>

      <figcaption className="chart__caption">{caption}</figcaption>

      <details className="tech chart__table">
        <summary>Table view</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{tableLabel}</th>
              <th scope="col">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                <td className="t-num">
                  {item.value}
                  {item.note ? ` · ${item.note}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * One stacked bar for part-to-whole composition. Segments are separated by a 2px
 * gap in the surface colour, never by a stroke.
 */
export function StackedBar({
  data,
  caption,
  total: totalOverride,
}: {
  data: BarDatum[];
  caption: string;
  total?: number;
}) {
  const total = totalOverride ?? data.reduce((sum, item) => sum + item.value, 0);
  const present = data.filter((item) => item.value > 0);

  return (
    <figure className="chart">
      <div className="stack" role="img" aria-label={`${caption}. ${data.map((item) => `${item.label} ${item.value}`).join(", ")}.`}>
        {present.map((item) => (
          <span
            key={item.label}
            className={`stack__seg stack__seg--${item.tone ?? "brand"}`}
            style={{ flexGrow: item.value }}
          />
        ))}
      </div>

      <ul className="chart__legend">
        {data.map((item) => (
          <li key={item.label}>
            <span className={`chart__key chart__key--${item.tone ?? "brand"}`} aria-hidden="true" />
            {item.label}
            <span className="chart__legend-value t-num">{item.value}</span>
          </li>
        ))}
      </ul>

      <figcaption className="chart__caption">
        {caption} · {total} total
      </figcaption>
    </figure>
  );
}

export function ChartCard({
  title,
  question,
  children,
  action,
}: {
  title: string;
  question: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <div style={{ minWidth: 0 }}>
          <h3>{title}</h3>
          <p className="t-caption">{question}</p>
        </div>
        {action ? <div style={{ marginLeft: "auto", flex: "none" }}>{action}</div> : null}
      </div>
      <div className="panel__body">{children}</div>
    </section>
  );
}
