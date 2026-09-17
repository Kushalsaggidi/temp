import type { TrustDimension, TrustScore } from "@/contracts";

import { IconAlert, IconCheck, IconMinus, IconX } from "./icons";

const SIZES = { sm: 32, md: 44, lg: 76 } as const;
const STROKES = { sm: 3, md: 4, lg: 6 } as const;

type Size = keyof typeof SIZES;

/**
 * An analytical trust indicator. Every point traces back to a governance gate,
 * so it is labelled as derived rather than presented as a rating.
 */
export function TrustRing({
  trust,
  size = "md",
  showMeta = true,
  sublabel,
}: {
  trust: TrustScore;
  size?: Size;
  showMeta?: boolean;
  sublabel?: string;
}) {
  const box = SIZES[size];
  const stroke = STROKES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - trust.score / 100);

  return (
    <div className={`trust trust--${size}`}>
      <div
        className="trust__ring"
        style={{ width: box, height: box }}
        role="img"
        aria-label={`Trust ${trust.score} out of 100. ${trust.label}. ${trust.passing_gates} of ${trust.required_gates} required gates passing.`}
      >
        <svg width={box} height={box}>
          <circle
            className="trust__track"
            cx={box / 2}
            cy={box / 2}
            r={radius}
            strokeWidth={stroke}
          />
          <circle
            className={`trust__value stroke-${trust.band}`}
            cx={box / 2}
            cy={box / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <span className={`trust__num tone-${trust.band}`}>{trust.score}</span>
      </div>
      {showMeta ? (
        <span className="trust__meta">
          <span className={`trust__label tone-${trust.band}`}>{trust.label}</span>
          <span className="trust__sub">
            {sublabel ?? `${trust.passing_gates}/${trust.required_gates} gates passing`}
          </span>
        </span>
      ) : null}
    </div>
  );
}

const DIMENSION_ICON: Record<TrustDimension["status"], typeof IconCheck> = {
  passed: IconCheck,
  attention: IconAlert,
  failed: IconX,
  not_required: IconMinus,
};

const DIMENSION_TONE: Record<TrustDimension["status"], string> = {
  passed: "tone-strong",
  attention: "tone-attention",
  failed: "tone-blocked",
  not_required: "",
};

export function TrustBreakdown({ trust }: { trust: TrustScore }) {
  return (
    <dl className="trust-breakdown">
      {trust.dimensions.map((dimension) => {
        const Glyph = DIMENSION_ICON[dimension.status];
        return (
          <div className="trust-dim" key={dimension.key}>
            <Glyph
              className={`trust-dim__icon ${DIMENSION_TONE[dimension.status]}`}
              style={{ color: dimension.status === "not_required" ? "var(--text-muted)" : undefined }}
            />
            <dt className="trust-dim__name">{dimension.label}</dt>
            <dd className="trust-dim__detail">{dimension.detail}</dd>
          </div>
        );
      })}
    </dl>
  );
}
