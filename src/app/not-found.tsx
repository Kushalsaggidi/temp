import Link from "next/link";

import { AppShell } from "@/components/shell/app-shell";
import { IconEmpty } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <AppShell area="marketplace" crumbs={[{ label: "Not found" }]}>
      <div className="empty" style={{ marginTop: "var(--sp-10)" }}>
        <span className="empty__icon">
          <IconEmpty style={{ width: 20, height: 20 }} />
        </span>
        <h3>That asset is not available</h3>
        <p>
          It may be a draft, deprecated, or superseded by a newer version. Only current
          published, non-deprecated versions appear in the public catalog.
        </p>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Link className="btn btn--sm" href="/marketplace">
            Browse the marketplace
          </Link>
          <Link className="btn btn--sm btn--secondary" href="/discovery">
            Search discovery
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
