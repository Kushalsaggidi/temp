import type { OperatorContext } from "@/contracts";
import { runOperator } from "@/modules/operator";

/**
 * Ask the AI Operator from the command line, without a browser.
 *
 *   npm run operator:ask -- "why is the Resident Communication Planner flagged?"
 *   npm run operator:ask -- --asset av_resident_comms_1_1_0 "why is this flagged?"
 *
 * This is the read path only. It never performs a state change: a write
 * capability reached this way prints its action preview and stops, exactly as
 * it does in the UI.
 */

const argv = process.argv.slice(2);
let assetVersionId: string | null = null;
const words: string[] = [];

for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]!;
  if (value === "--asset" || value === "-a") {
    assetVersionId = argv[index + 1] ?? null;
    index += 1;
    continue;
  }
  words.push(value);
}

const utterance = words.join(" ").trim();
if (utterance.length === 0) {
  console.error('Usage: npm run operator:ask -- [--asset <av_id>] "your request"');
  process.exit(1);
}

const context: OperatorContext = {
  surface: assetVersionId === null ? "control_center" : "asset",
  label: assetVersionId === null ? "AI Control Center" : assetVersionId,
  asset_version_id: assetVersionId,
  asset_name: null,
  compare_ids: [],
};

const response = await runOperator({ utterance, context });

const rule = "─".repeat(72);
console.log(rule);
console.log(`› ${response.utterance}`);
console.log(rule);
console.log(
  [
    `intent      ${response.understanding.intent}`,
    `capability  ${response.understanding.tool ?? "none"} (${response.understanding.kind ?? "n/a"})`,
    `routed by   ${response.understanding.routed_by} · confidence ${response.understanding.confidence}`,
    `optional AI ${response.ai.state}${response.ai.model_or_config ? ` · ${response.ai.model_or_config}` : ""}`,
  ].join("\n"),
);
if (response.understanding.resolved_asset !== null) {
  console.log(`resolved    ${response.understanding.resolved_asset.how}`);
}
console.log(rule);

for (const block of response.blocks) {
  switch (block.kind) {
    case "headline":
      console.log(`\n[${block.eyebrow ?? block.tone}] ${block.title}`);
      if (block.detail) console.log(`  ${block.detail}`);
      break;
    case "assets":
      console.log(`\n${block.title}`);
      for (const card of block.items) {
        console.log(
          `  · ${card.name} — readiness ${card.trust?.score ?? "n/a"} · ${card.lifecycle} · ${card.asset_version_id}`,
        );
      }
      break;
    case "facts":
      console.log(`\n${block.title}`);
      for (const item of block.items) console.log(`  ${item.label}: ${item.value}`);
      break;
    case "signals":
      console.log(`\n${block.title}`);
      for (const item of block.items) {
        console.log(`  [${item.status}] ${item.label}`);
      }
      break;
    case "why":
      console.log(`\nWHY — ${block.question}`);
      for (const link of block.chain) console.log(`  ↓ ${link.label}`);
      console.log(`  = ${block.conclusion}`);
      break;
    case "action_preview":
      console.log(
        `\nACTION PREVIEW — ${block.action.label} (${block.action.available ? "ready" : "unavailable"})`,
      );
      console.log(`  ${block.action.summary}`);
      for (const effect of block.action.effects) console.log(`  · ${effect}`);
      if (!block.action.available) console.log(`  ✕ ${block.action.unavailable_reason}`);
      console.log("  Nothing was changed. Approve it in the UI to run it.");
      break;
    case "plan":
      console.log(`\nPLAN — ${block.plan.title}`);
      for (const step of block.plan.steps) {
        console.log(
          `  ${String(step.index).padStart(2, "0")} ${step.title} [${step.kind}${step.confirm_required ? " · asks again" : ""}]`,
        );
      }
      break;
    case "blocked":
      console.log(`\nBLOCKED — ${block.title}`);
      console.log(`  ${block.reason}`);
      for (const line of block.detail) console.log(`  · ${line}`);
      break;
    case "inference":
      console.log(`\nINTERPRETATION (${block.ai.state}, not a verified fact)`);
      console.log(`  ${block.text}`);
      break;
    case "note":
      console.log(`\n  ${block.text}`);
      break;
    default:
      console.log(`\n[${block.kind}]`);
  }
}

console.log(`\n${rule}`);
console.log(
  `trace  ${response.trace.map((item) => `${item.tool}:${item.status} ${item.duration_ms}ms`).join(" · ")}`,
);
if (response.suggestions.length > 0) {
  console.log(`next   ${response.suggestions.map((item) => `"${item.utterance}"`).join("  ")}`);
}
