import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OperatorBlocks } from "@/components/operator/blocks";
import { suggestionsForSurface } from "@/components/operator/context";
import type { OperatorContext, OperatorResponse } from "@/contracts";
import { GeminiOperatorAdapter } from "@/modules/operator/ai";
import { runOperator } from "@/modules/operator";
import { DATA_DIRECTORY, removeDatabaseFiles } from "@/server/db";
import { resetAndSeedDemoDatabase } from "@/server/db/reset";

const DATABASE_PATH = join(DATA_DIRECTORY, "operator-ui.test.sqlite");
const STALE = "av_resident_comms_1_1_0";
const adapter = new GeminiOperatorAdapter({ enabled: false });
const NOW = new Date("2026-09-17T09:00:00Z");

function context(): OperatorContext {
  return {
    surface: "asset",
    label: "Resident Communication Planner",
    asset_version_id: STALE,
    asset_name: "Resident Communication Planner",
    compare_ids: [],
  };
}

function ask(utterance: string): Promise<OperatorResponse> {
  return runOperator(
    { utterance, context: context() },
    { adapter, now: NOW, databasePath: DATABASE_PATH },
  );
}

function render(response: OperatorResponse): string {
  return renderToStaticMarkup(
    createElement(OperatorBlocks, {
      blocks: response.blocks,
      now: NOW.getTime(),
    }),
  );
}

describe("operator visual answers", () => {
  beforeAll(async () => {
    mkdirSync(DATA_DIRECTORY, { recursive: true });
    await resetAndSeedDemoDatabase(DATABASE_PATH);
  }, 90_000);

  afterAll(() => {
    removeDatabaseFiles(DATABASE_PATH);
  });

  it("renders an investigation as components, not a wall of text", async () => {
    const markup = render(await ask("Why is this flagged?"));

    // Each of these is a distinct visual component, not a paragraph.
    for (const className of [
      "ab-headline",
      "trust__ring",
      "ab-signals",
      "ab-chain",
      "evidence-list",
      "ab-inference",
      "ab-sources",
    ]) {
      expect(markup, className).toContain(className);
    }
  });

  it("labels model interpretation separately from observed fact", async () => {
    const markup = render(await ask("Why is this flagged?"));
    expect(markup).toContain("Deterministic interpretation");
    expect(markup).toContain("no model used");
  });

  it("renders search results as asset cards carrying real readiness", async () => {
    const markup = render(await ask("Find a property operations brief"));
    expect(markup).toContain("ab-asset");
    expect(markup).toContain("trust__ring");
    expect(markup).toMatch(/href="\/assets\/av_/);
  });

  it("renders a write as a preview with both outcomes and an approval gate", async () => {
    const markup = render(await ask("What happens if I flag this?"));

    expect(markup).toContain("Action preview");
    expect(markup).toContain(">Now<");
    expect(markup).toContain(">After<");
    expect(markup).toContain("This will");
    expect(markup).toContain("Cancel");
    expect(markup).toMatch(/Approve &amp; flag for re-review/i);
    // The irreversibility of a lifecycle change is stated, not implied.
    expect(markup).toMatch(/cannot be undone|append-only/i);
  });

  it("renders a plan with every step visible before anything runs", async () => {
    const response = await ask("Create a fraud detection agent");
    const markup = renderToStaticMarkup(
      createElement(OperatorBlocks, { blocks: response.blocks, now: NOW.getTime() }),
    );

    expect(markup).toContain("ab-contrib");
    expect(markup).toContain("ab-steps");
    expect(markup).toContain("Create the draft");
    expect(markup).toContain("Submit for review");
    // Nothing has run: no step reports an outcome and the last one asks again.
    expect(markup).toContain("ab-step--pending");
    expect(markup).not.toContain("ab-step--complete");
    expect(markup).toContain("asks again");
    expect(markup.match(/pill pill--warning">write</g)?.length).toBe(4);
  });

  it("offers an execute affordance only when a plan can actually be run", async () => {
    const response = await ask("Create a fraud detection agent");
    const plan = response.blocks.find((block) => block.kind === "plan");
    if (plan?.kind !== "plan") throw new Error("expected a plan");

    const inert = renderToStaticMarkup(
      createElement(OperatorBlocks, { blocks: [plan], now: NOW.getTime() }),
    );
    expect(inert).not.toContain("Execute plan");

    const runnable = renderToStaticMarkup(
      createElement(OperatorBlocks, {
        blocks: [plan],
        now: NOW.getTime(),
        onRunPlan: () => undefined,
      }),
    );
    expect(runnable).toContain("Execute plan");
    expect(runnable).toContain("Nothing has run yet");
  });

  it("renders the capability catalogue with read and write clearly separated", async () => {
    const markup = render(await ask("What actions can I perform?"));
    expect(markup).toContain("needs approval");
    expect(markup).toContain("runs directly");
    expect(markup).toContain("ab-cap__backed");
  });

  it("renders unavailable capabilities as unavailable rather than hiding them", async () => {
    const markup = render(await ask("Archive this"));
    expect(markup).toContain("ab-blocked");
    expect(markup).toMatch(/no archive lifecycle state/i);
  });

  it("offers only context-appropriate openers on each surface", () => {
    const asset = suggestionsForSurface(context());
    expect(asset.some((item) => item.utterance.includes("Resident Communication Planner"))).toBe(
      true,
    );

    const drift = suggestionsForSurface({
      surface: "drift",
      label: "Recent changes",
      asset_version_id: null,
      asset_name: null,
      compare_ids: [],
    });
    expect(drift.every((item) => !item.utterance.includes("undefined"))).toBe(true);
    expect(drift.length).toBeGreaterThan(0);
  });
});
