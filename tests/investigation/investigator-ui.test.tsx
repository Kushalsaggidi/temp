import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoCatalogEntries } from "../../fixtures/catalog/published-catalog";
import { InvestigationDrawer } from "@/components/investigation/investigation-drawer";
import { buildInvestigationReport, type InvestigationSubject } from "@/modules/investigation";

const current = demoCatalogEntries.find(
  (entry) => entry.record.asset_version.asset_version_id === "av_resident_comms_1_1_0",
)!.record;
const previous = demoCatalogEntries.find(
  (entry) => entry.record.asset_version.asset_version_id === "av_resident_comms_1_0_0",
)!.record;

const subject: InvestigationSubject = {
  record: current,
  evidence: [],
  executions: [],
  previous: { record: previous, evidence: [] },
};

async function renderDrawer() {
  const report = await buildInvestigationReport(subject, {
    now: new Date("2026-09-16T18:00:00Z"),
  });
  return renderToStaticMarkup(
    createElement(InvestigationDrawer, {
      state: {
        phase: "ready",
        assetVersionId: report.asset_version_id,
        assetName: report.asset_name,
        report,
      },
      onClose: () => undefined,
      onAction: async () => true,
    }),
  );
}

describe("investigator drawer", () => {
  it("renders the full investigation sequence in order", async () => {
    const markup = await renderDrawer();

    const order = ["What changed", "Why it matters", "Recommended actions", "Supporting evidence"];
    let cursor = -1;
    for (const heading of order) {
      // Match the section heading itself, not the same word inside the trust breakdown.
      const index = markup.indexOf(`<h3>${heading}</h3>`);
      expect(index, `${heading} should appear`).toBeGreaterThan(-1);
      expect(index, `${heading} should follow the previous section`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("keeps observation, inference, and recommendation visually distinct", async () => {
    const markup = await renderDrawer();

    expect(markup).toContain("register--observation");
    expect(markup).toContain("register--inference");
    expect(markup).toContain("What we found");
    expect(markup).toContain("AI explanation");
    expect(markup).toContain("Not verified");
    expect(markup).toContain("From saved records");
    // The recommendation is stated separately from the findings.
    expect(markup).toContain("Recommended actions");
  });

  it("is an accessible dialog with a close control", async () => {
    const markup = await renderDrawer();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Close"');
  });

  it("shows a working state rather than a fake progress percentage", () => {
    const markup = renderToStaticMarkup(
      createElement(InvestigationDrawer, {
        state: {
          phase: "loading",
          assetVersionId: "av_resident_comms_1_1_0",
          assetName: "Resident Communication Planner",
        },
        onClose: () => undefined,
        onAction: async () => true,
      }),
    );

    expect(markup).toContain("Checking");
    expect(markup).toContain("Reading the required checks");
    expect(markup).not.toMatch(/\d+%/);
  });

  it("presents a designed error state with no raw error object", () => {
    const markup = renderToStaticMarkup(
      createElement(InvestigationDrawer, {
        state: {
          phase: "error",
          assetVersionId: "av_resident_comms_1_1_0",
          assetName: "Resident Communication Planner",
          message: "The investigation could not be completed.",
        },
        onClose: () => undefined,
        onAction: async () => true,
      }),
    );

    expect(markup).toContain("We could not check this asset");
    expect(markup).not.toContain("stack");
    expect(markup).not.toContain("Error:");
  });
});
