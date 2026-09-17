"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconArrowRight, IconLayers, IconSparkle } from "@/components/ui/icons";
import type { AgentProfile, OperatorToolGroup, ToolProfile } from "@/contracts";

import { useAiContext } from "./context";

/**
 * The Agent Explorer. It documents what actually runs: where each agent lives
 * in the repository, which model it may call, what it is allowed to decide, and
 * the capability catalogue underneath all of them.
 */
export function AgentExplorer({
  agents,
  groups,
}: {
  agents: AgentProfile[];
  groups: { group: OperatorToolGroup; label: string; tools: ToolProfile[] }[];
}) {
  const router = useRouter();
  const { setOpen } = useAiContext();
  const [activeKey, setActiveKey] = useState(agents[0]?.key ?? "");
  const active = agents.find((agent) => agent.key === activeKey) ?? agents[0];

  function ask(utterance: string) {
    setOpen(false);
    router.push(`/control?ask=${encodeURIComponent(utterance)}`);
  }

  if (active === undefined) return null;

  return (
    <div className="ax">
      <nav className="ax-list" aria-label="Agents">
        {agents.map((agent) => (
          <button
            className={`ax-item${agent.key === active.key ? " is-active" : ""}`}
            type="button"
            key={agent.key}
            aria-current={agent.key === active.key ? "true" : undefined}
            onClick={() => setActiveKey(agent.key)}
          >
            <span className="ax-item__mark" aria-hidden="true">
              <IconSparkle style={{ width: 12, height: 12 }} />
            </span>
            <span className="ax-item__body">
              <strong>{agent.name}</strong>
              <em>{agent.model_or_config ?? "Deterministic"}</em>
            </span>
          </button>
        ))}
      </nav>

      <div className="ax-detail">
        <header className="ax-detail__head">
          <h2>{active.name}</h2>
          <span className={`pill ${active.model_or_config ? "pill--ai" : "pill--success"}`}>
            <span className="pill__dot" />
            {active.model_or_config ?? "No model — fully deterministic"}
          </span>
        </header>
        <p className="ax-detail__purpose">{active.purpose}</p>

        <div className="ax-grid">
          <section>
            <p className="t-label">Capabilities</p>
            <ul className="ab-agent__list">
              {active.capabilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <p className="t-label">Inputs</p>
            <ul className="ab-agent__list">
              {active.inputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <p className="t-label">Outputs</p>
            <ul className="ab-agent__list">
              {active.outputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <p className="t-label">Authority limit</p>
            <ul className="ab-agent__list ab-agent__list--limit">
              {active.authority.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="ax-meta">
          <p className="ax-meta__row">
            <IconLayers style={{ width: 13, height: 13 }} />
            <span className="t-mono">{active.implementation}</span>
          </p>
          <p className="ax-meta__row">
            <span className="t-label">Without the model</span>
            {active.deterministic_fallback}
          </p>
          <p className="ax-meta__row">
            <span className="t-label">Tools it uses</span>
            <span className="t-mono">{active.tools.join(", ")}</span>
          </p>
        </div>

        {active.actions.length > 0 ? (
          <div className="ax-actions">
            <p className="t-label">Try it</p>
            <div className="chips">
              {active.actions.map((action) => (
                <button
                  className="chip"
                  type="button"
                  key={action.utterance}
                  title={action.hint ?? undefined}
                  onClick={() => ask(action.utterance)}
                >
                  {action.label}
                  <IconArrowRight style={{ width: 11, height: 11 }} />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <section className="ax-tools">
        <header>
          <h2>Capability catalogue</h2>
          <p className="t-small">
            Everything the operator can do, and which half of it needs your approval first.
            There is no route from a request to the database that does not go through one of
            these.
          </p>
        </header>
        <div className="ab-caps">
          {groups.map((group) => (
            <section className="ab-cap-group" key={group.group}>
              <h3>{group.label}</h3>
              <ul>
                {group.tools.map((tool) => (
                  <li
                    className={`ab-cap${tool.available ? "" : " ab-cap--off"}`}
                    key={tool.name}
                  >
                    <span className="ab-cap__name t-mono">{tool.name}</span>
                    <span
                      className={`pill ${tool.kind === "write" ? "pill--warning" : "pill--success"}`}
                    >
                      {tool.kind === "write" ? "needs approval" : "runs directly"}
                    </span>
                    <p className="ab-cap__summary">
                      {tool.available ? tool.summary : tool.unavailable_reason}
                    </p>
                    <p className="ab-cap__backed t-mono">{tool.backed_by}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
