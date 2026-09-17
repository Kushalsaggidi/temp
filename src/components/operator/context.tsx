"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { OperatorContext, OperatorSuggestion, OperatorSurface } from "@/contracts";

export interface AiContextValue {
  context: OperatorContext;
  open: boolean;
  setOpen(next: boolean): void;
  register(context: Partial<OperatorContext> & { surface: OperatorSurface; label: string }): void;
  clear(surface: OperatorSurface): void;
}

const AiContextStore = createContext<AiContextValue | null>(null);

/** Surfaces the AI Lens can infer without a page registering anything. */
const PATH_SURFACE: { match: RegExp; surface: OperatorSurface; label: string }[] = [
  { match: /^\/$/, surface: "overview", label: "Marketplace overview" },
  { match: /^\/marketplace/, surface: "marketplace", label: "Marketplace" },
  { match: /^\/discovery/, surface: "discovery", label: "Discovery" },
  { match: /^\/compare/, surface: "compare", label: "Comparison" },
  { match: /^\/drift/, surface: "drift", label: "Recent changes" },
  { match: /^\/governance/, surface: "governance", label: "Governance" },
  { match: /^\/contribute/, surface: "contribute", label: "Contribution" },
  { match: /^\/agents/, surface: "agents", label: "Agent Explorer" },
  { match: /\/try$/, surface: "execution", label: "Run" },
  { match: /^\/assets/, surface: "asset", label: "Asset" },
  { match: /^\/control/, surface: "control_center", label: "AI Control Center" },
];

function fromPath(pathname: string): OperatorContext {
  const match = PATH_SURFACE.find((entry) => entry.match.test(pathname));
  return {
    surface: match?.surface ?? "marketplace",
    label: match?.label ?? "Marketplace",
    asset_version_id: null,
    asset_name: null,
    compare_ids: [],
  };
}

/**
 * Holds what the person is currently looking at, so a request made anywhere in
 * the product already knows which asset "this" means. Pages that know more than
 * the URL does register it; everything else is inferred from the route.
 */
export function AiContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [registered, setRegistered] = useState<OperatorContext | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setRegistered(null);
    setOpen(false);
  }, [pathname]);

  const register = useCallback(
    (next: Partial<OperatorContext> & { surface: OperatorSurface; label: string }) => {
      setRegistered({
        surface: next.surface,
        label: next.label,
        asset_version_id: next.asset_version_id ?? null,
        asset_name: next.asset_name ?? null,
        compare_ids: next.compare_ids ?? [],
      });
    },
    [],
  );

  const clear = useCallback((surface: OperatorSurface) => {
    setRegistered((current) => (current?.surface === surface ? null : current));
  }, []);

  const value = useMemo<AiContextValue>(
    () => ({
      context: registered ?? fromPath(pathname ?? "/"),
      open,
      setOpen,
      register,
      clear,
    }),
    [clear, open, pathname, register, registered],
  );

  return <AiContextStore.Provider value={value}>{children}</AiContextStore.Provider>;
}

export function useAiContext(): AiContextValue {
  const value = useContext(AiContextStore);
  if (value === null) {
    return {
      context: {
        surface: "marketplace",
        label: "Marketplace",
        asset_version_id: null,
        asset_name: null,
        compare_ids: [],
      },
      open: false,
      setOpen: () => undefined,
      register: () => undefined,
      clear: () => undefined,
    };
  }
  return value;
}

/**
 * Rendered by a server page to tell the AI Lens exactly what is on screen.
 * It draws nothing.
 */
export function SetAiContext({
  surface,
  label,
  assetVersionId = null,
  assetName = null,
  compareIds = [],
}: {
  surface: OperatorSurface;
  label: string;
  assetVersionId?: string | null;
  assetName?: string | null;
  compareIds?: string[];
}) {
  const { register, clear } = useAiContext();
  const ids = compareIds.join(",");

  useEffect(() => {
    register({
      surface,
      label,
      asset_version_id: assetVersionId,
      asset_name: assetName,
      compare_ids: ids.length === 0 ? [] : ids.split(","),
    });
    return () => clear(surface);
  }, [assetName, assetVersionId, clear, ids, label, register, surface]);

  return null;
}

/** Context-specific openers. Every one maps to a capability that exists. */
export function suggestionsForSurface(context: OperatorContext): OperatorSuggestion[] {
  const named = context.asset_name === null ? "this asset" : `"${context.asset_name}"`;

  switch (context.surface) {
    case "asset":
    case "execution":
      return [
        { label: "Why is this flagged?", utterance: `Why is ${named} flagged?`, hint: "Runs the investigation." },
        { label: "What changed?", utterance: `What changed on ${named}?`, hint: "Compares against the previous published version." },
        { label: "Show evidence", utterance: `Show the evidence behind ${named}`, hint: "Digest-bound evidence records." },
        { label: "Find alternatives", utterance: `Find an alternative to ${named}`, hint: "Ranked by the discovery ranker." },
        { label: "Who is affected?", utterance: `Who could be affected by ${named}?`, hint: "The impact graph." },
        { label: "Preview flagging it", utterance: `What happens if I flag ${named}?`, hint: "Impact preview; nothing changes." },
      ];
    case "governance":
      return context.asset_version_id === null
        ? [
            { label: "What is in the queue?", utterance: "What is in the review queue?", hint: null },
            { label: "What needs attention?", utterance: "Give me the marketplace overview", hint: null },
            { label: "Explain the gates", utterance: "What checks are performed?", hint: null },
          ]
        : [
            { label: "What is blocking this?", utterance: `What is blocking ${named}?`, hint: null },
            { label: "Show evidence", utterance: `Show the evidence behind ${named}`, hint: null },
            { label: "Run the checks", utterance: `Run the governance checks on ${named}`, hint: "Asks before writing." },
            { label: "Prepare for review", utterance: `Prepare ${named} for governance review`, hint: "Builds a plan." },
          ];
    case "compare":
      return [
        { label: "What actually differs?", utterance: "Compare these two assets", hint: null },
        { label: "Which is better checked?", utterance: "Give me the marketplace overview", hint: null },
      ];
    case "drift":
      return [
        { label: "Investigate the biggest change", utterance: "Which assets have changed trust recently?", hint: null },
        { label: "What is in review?", utterance: "What is in the review queue?", hint: null },
        { label: "How does trust work?", utterance: "How does trust work?", hint: null },
      ];
    case "discovery":
    case "marketplace":
      return [
        { label: "Marketplace overview", utterance: "Give me the marketplace overview", hint: null },
        { label: "What has drifted?", utterance: "Which assets have changed trust recently?", hint: null },
        { label: "What is in review?", utterance: "What is in the review queue?", hint: null },
        { label: "Explain this project", utterance: "Explain this project", hint: null },
      ];
    case "contribute":
      return [
        { label: "Draft a contribution", utterance: "I want to contribute a fraud detection agent", hint: "Drafts metadata and a plan." },
        { label: "What do reviewers check?", utterance: "What checks are performed?", hint: null },
        { label: "Explain the lifecycle", utterance: "Explain the complete lifecycle of an asset", hint: null },
      ];
    case "agents":
      return [
        { label: "What agents exist?", utterance: "What agents are available?", hint: null },
        { label: "What can you do?", utterance: "What actions can I perform?", hint: null },
      ];
    default:
      return [
        { label: "Marketplace overview", utterance: "Give me the marketplace overview", hint: null },
        { label: "What has drifted?", utterance: "Which assets have changed trust recently?", hint: null },
        { label: "Explain this project", utterance: "Explain this project", hint: null },
      ];
  }
}
