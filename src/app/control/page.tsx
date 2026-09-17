import type { Metadata } from "next";
import { Suspense } from "react";

import { ControlCenter } from "@/components/operator/control-center";
import { SetAiContext } from "@/components/operator/context";
import { AppShell } from "@/components/shell/app-shell";
import { loadSystemState, toolProfiles } from "@/modules/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Control Center",
  description:
    "Operate the marketplace in plain language: find, investigate, compare, plan, preview, act, and verify.",
};

export default async function ControlCenterPage() {
  const state = loadSystemState();
  const tools = toolProfiles();

  return (
    <AppShell area="control" wide crumbs={[{ label: "AI Control Center" }]}>
      <SetAiContext surface="control_center" label="AI Control Center" />
      <Suspense fallback={<div className="skeleton skeleton--card" />}>
        <ControlCenter state={state} tools={tools} now={Date.now()} />
      </Suspense>
    </AppShell>
  );
}
