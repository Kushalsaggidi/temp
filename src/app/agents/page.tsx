import Link from "next/link";
import type { Metadata } from "next";

import { AgentExplorer } from "@/components/operator/agent-explorer";
import { SetAiContext } from "@/components/operator/context";
import { AppShell } from "@/components/shell/app-shell";
import { IconArrowRight } from "@/components/ui/icons";
import { AGENTS, GROUP_LABEL, toolProfiles } from "@/modules/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Explorer",
  description:
    "Every agent in this system: what it does, what it may decide, and what it cannot.",
};

export default function AgentExplorerPage() {
  const tools = toolProfiles();
  const groups = (Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[])
    .map((group) => ({
      group,
      label: GROUP_LABEL[group],
      tools: tools.filter((tool) => tool.group === group),
    }))
    .filter((entry) => entry.tools.length > 0);

  return (
    <AppShell
      area="agents"
      wide
      crumbs={[{ label: "Agent Explorer" }]}
      actions={
        <Link className="btn btn--sm" href="/control">
          Open AI Control Center <IconArrowRight className="btn__icon" />
        </Link>
      }
    >
      <SetAiContext surface="agents" label="Agent Explorer" />
      <header className="page-head">
        <h1>Agent Explorer</h1>
        <p>
          {AGENTS.length} agents run in this product. Each one has a bounded purpose, a
          declared authority limit, and a deterministic path it falls back to. None of them
          can approve, publish, or add a governance fact.
        </p>
      </header>
      <AgentExplorer agents={[...AGENTS]} groups={groups} />
    </AppShell>
  );
}
