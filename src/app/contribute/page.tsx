import Link from "next/link";
import type { Metadata } from "next";

import { ContributionForm } from "@/components/governance/contribution-form";
import { AppShell } from "@/components/shell/app-shell";
import { IconArrowRight } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Contribute",
  description: "Package reusable work for Marketplace review.",
};

const STEPS = [
  {
    title: "Check it does not exist",
    detail: "We search as you type. Reusing something is always faster than rebuilding it.",
  },
  {
    title: "Explain the job",
    detail: "State the purpose, audience, domain, capabilities, and concrete use cases.",
  },
  {
    title: "Say how it works",
    detail: "What goes in, what comes out, and anything it will not do.",
  },
  {
    title: "Say where it came from",
    detail: "Name who looks after it and confirm you are allowed to share it.",
  },
];

export default function ContributePage() {
  return (
    <AppShell area="contribute" wide crumbs={[{ label: "Contribute" }]}>
      <header className="page-head">
        <div className="page-head__row">
          <div>
            <h1>Turn useful work into a reusable asset.</h1>
            <p>
              Share something you built so other teams can use it instead of starting over.
              A person reviews everything before it appears in the marketplace.
            </p>
          </div>
          <Link className="btn btn--secondary" href="/governance">
            See the review queue <IconArrowRight className="btn__icon" />
          </Link>
        </div>
      </header>

      <ol className="stats" style={{ marginBottom: "var(--sp-8)", listStyle: "none", padding: 0 }}>
        {STEPS.map((step, index) => (
          <li className="stat" key={step.title}>
            <span className="stat__value t-num" style={{ fontSize: "1.125rem" }}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="stat__label">{step.title}</span>
            <span className="stat__hint">{step.detail}</span>
          </li>
        ))}
      </ol>

      <ContributionForm />
    </AppShell>
  );
}
