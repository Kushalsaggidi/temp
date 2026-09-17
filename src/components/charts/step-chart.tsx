import type { DriftStep } from "@/contracts";

/**
 * Discrete state transitions, not a continuous trend.
 *
 * The underlying system records a trust score only at documented moments — a
 * version was published, evidence was recorded — so the chart plots those points
 * and joins them with a step, rather than drawing a smooth line through values
 * that were never measured. The step shape is the honest encoding here.
 */
export function StepChart({
  steps,
  caption,
}: {
  steps: DriftStep[];
  caption: string;
}) {
  if (steps.length < 2) return null;

  const width = 520;
  const height = 150;
  const padLeft = 34;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 34;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const x = (index: number) =>
    padLeft + (steps.length === 1 ? plotWidth / 2 : (index / (steps.length - 1)) * plotWidth);
  const y = (score: number) => padTop + (1 - score / 100) * plotHeight;

  // Step path: hold the previous value, then drop or rise at the transition.
  const path = steps
    .map((step, index) =>
      index === 0
        ? `M ${x(0)} ${y(step.score)}`
        : `L ${x(index)} ${y(steps[index - 1]!.score)} L ${x(index)} ${y(step.score)}`,
    )
    .join(" ");

  const ticks = [0, 50, 100];

  return (
    <figure className="chart">
      <svg
        className="step"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${caption}. ${steps.map((step) => `${step.label}: trust ${step.score}`).join("; ")}.`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="step__grid"
              x1={padLeft}
              x2={width - padRight}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="step__tick" x={padLeft - 8} y={y(tick) + 3.5} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        <path className="step__line" d={path} />

        {steps.map((step, index) => (
          <g key={`${step.label}-${step.timestamp}`}>
            <circle
              className={`step__dot${index === steps.length - 1 ? " step__dot--current" : ""}`}
              cx={x(index)}
              cy={y(step.score)}
              r={4.5}
            />
            <text
              className="step__value"
              x={x(index)}
              y={y(step.score) - 11}
              textAnchor={index === 0 ? "start" : index === steps.length - 1 ? "end" : "middle"}
            >
              {step.score}
            </text>
            <text
              className="step__label"
              x={x(index)}
              y={height - 12}
              textAnchor={index === 0 ? "start" : index === steps.length - 1 ? "end" : "middle"}
            >
              {step.label}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className="chart__caption">{caption}</figcaption>

      <details className="tech chart__table">
        <summary>Table view</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Trust</th>
              <th scope="col">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={`${step.label}-${step.timestamp}`}>
                <th scope="row">{step.label}</th>
                <td className="t-num">{step.score}</td>
                <td className="t-caption">
                  {new Date(step.timestamp).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
