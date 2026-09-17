import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveryPanel } from "@/components/discovery/discovery-panel";
import { AppShell } from "@/components/shell/app-shell";

describe("discovery UI", () => {
  it("renders accessible query and optional-context controls", () => {
    const markup = renderToStaticMarkup(createElement(DiscoveryPanel));
    expect(markup).toContain('id="discovery-query"');
    expect(markup).toContain("What do you need help with?");
    expect(markup).toContain("Audience");
    expect(markup).toContain("Desired output");
    expect(markup).not.toMatch(/confidence|% match/i);
  });

  it("marks Discovery as the current navigation area and keeps Governance visible", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        area: "discovery",
        children: createElement("p", null, "content"),
      }),
    );
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/discovery"/);
    expect(markup).toContain('href="/governance"');
  });
});
