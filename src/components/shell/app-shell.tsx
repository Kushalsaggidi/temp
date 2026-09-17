import Link from "next/link";
import type { ReactNode } from "react";

import {
  IconAlert,
  IconContribute,
  IconClock,
  IconDiscovery,
  IconGovernance,
  IconLayers,
  IconMarketplace,
  IconOverview,
  IconSparkle,
} from "@/components/ui/icons";

export type ShellArea =
  | "overview"
  | "marketplace"
  | "under-construction"
  | "discovery"
  | "governance"
  | "drift"
  | "contribute"
  | "control"
  | "agents";

export interface Crumb {
  label: string;
  href?: string;
}

const PRIMARY = [
  { area: "overview", href: "/", label: "Overview", Icon: IconOverview },
  { area: "marketplace", href: "/marketplace", label: "Marketplace", Icon: IconMarketplace },
  {
    area: "under-construction",
    href: "/under-construction",
    label: "Under construction",
    Icon: IconClock,
  },
  { area: "discovery", href: "/discovery", label: "Discovery", Icon: IconDiscovery },
  { area: "governance", href: "/governance", label: "Governance", Icon: IconGovernance },
  { area: "drift", href: "/drift", label: "Recent changes", Icon: IconAlert },
] as const;

/**
 * One shell for every page: persistent navigation, a breadcrumb bar, and the
 * content column. Governance is primary navigation, not an admin footnote.
 */
export function AppShell({
  area,
  crumbs = [],
  actions,
  attentionCount,
  wide = false,
  children,
}: {
  area: ShellArea;
  crumbs?: Crumb[];
  actions?: ReactNode;
  attentionCount?: number;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="sidebar" aria-label="Primary">
        <Link className="brand" href="/">
          <span className="brand__mark" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" width={32} height={32} />
          </span>
          <span>
            <span className="brand__name">AI Marketplace</span>
            <span className="brand__org">RealPage</span>
          </span>
        </Link>

        <div className="nav-group">
          <p className="nav-group__label">Workspace</p>
          {PRIMARY.map(({ area: itemArea, href, label, Icon }) => (
            <Link
              className="nav-item"
              href={href}
              key={href}
              aria-current={area === itemArea ? "page" : undefined}
            >
              <Icon className="nav-item__icon" />
              {label}
              {itemArea === "drift" && attentionCount ? (
                <span className="nav-item__count nav-item__count--alert">
                  {attentionCount}
                </span>
              ) : null}
            </Link>
          ))}
        </div>

        <div className="nav-group">
          <p className="nav-group__label">Operate</p>
          <Link
            className="nav-item nav-item--ai"
            href="/control"
            aria-current={area === "control" ? "page" : undefined}
          >
            <IconSparkle className="nav-item__icon" />
            AI Control Center
          </Link>
          <Link
            className="nav-item"
            href="/agents"
            aria-current={area === "agents" ? "page" : undefined}
          >
            <IconLayers className="nav-item__icon" />
            Agent Explorer
          </Link>
        </div>

        <div className="nav-group">
          <p className="nav-group__label">Build</p>
          <Link
            className="nav-item"
            href="/contribute"
            aria-current={area === "contribute" ? "page" : undefined}
          >
            <IconContribute className="nav-item__icon" />
            Contribute asset
          </Link>
        </div>

        <p className="sidebar__foot">
          Prototype. Reviewer names are entered manually and are not
          identity-verified approvals.
        </p>
      </nav>

      <div className="main">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} style={{ display: "contents" }}>
                <span className="crumbs__sep" aria-hidden="true">
                  /
                </span>
                {crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span className="crumbs__current" aria-current="page">
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
          {actions ? <div className="topbar__actions">{actions}</div> : null}
        </header>

        <main className={`page${wide ? " page--wide" : ""}`} id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
