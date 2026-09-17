"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { InvestigationReport } from "@/contracts";
import { useToast } from "@/components/ui/toast";

import { InvestigationDrawer } from "./investigation-drawer";

interface InvestigationApi {
  open(assetVersionId: string, assetName: string): void;
  close(): void;
  activeId: string | null;
}

const InvestigationContext = createContext<InvestigationApi | null>(null);

export type InvestigationState =
  | { phase: "idle" }
  | { phase: "loading"; assetVersionId: string; assetName: string }
  | { phase: "ready"; assetVersionId: string; assetName: string; report: InvestigationReport }
  | { phase: "error"; assetVersionId: string; assetName: string; message: string };

export function InvestigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<InvestigationState>({ phase: "idle" });
  const request = useRef<AbortController | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const close = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setState({ phase: "idle" });
    restoreFocus.current?.focus();
    restoreFocus.current = null;
  }, []);

  /** Returns the readiness score of the loaded report, so callers can report a change. */
  const load = useCallback(
    async (assetVersionId: string, assetName: string): Promise<number | null> => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setState({ phase: "loading", assetVersionId, assetName });

      try {
        const response = await fetch(`/api/investigate/${assetVersionId}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || body === null) {
          throw new Error("We could not finish checking this asset.");
        }
        const report = body as InvestigationReport;
        setState({ phase: "ready", assetVersionId, assetName, report });
        return report.trust.score;
      } catch (cause) {
        if (controller.signal.aborted) return null;
        setState({
          phase: "error",
          assetVersionId,
          assetName,
          message:
            cause instanceof Error && cause.message
              ? cause.message
              : "We could not finish checking this asset. Nothing was changed.",
        });
      } finally {
        if (request.current === controller) request.current = null;
      }
      return null;
    },
    [],
  );

  const open = useCallback(
    (assetVersionId: string, assetName: string) => {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      void load(assetVersionId, assetName);
    },
    [load],
  );

  const runAction = useCallback(
    async (endpoint: string, body: Record<string, unknown>, label: string) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
              ? (payload as { error: { message: string } }).error.message
              : "The action could not be completed.";
          toast.push({ tone: "error", title: "Nothing was changed", detail: message });
          return false;
        }
        // Confirm what happened, whether readiness moved, and what comes next.
        const before = state.phase === "ready" ? state.report.trust.score : null;
        router.refresh();
        let after: number | null = null;
        if (state.phase === "ready" || state.phase === "loading") {
          after = await load(state.assetVersionId, state.assetName);
        }
        const moved = before !== null && after !== null && after !== before;
        toast.push({
          tone: "success",
          title: `Done: ${label.toLowerCase()}`,
          detail: moved
            ? `Readiness moved from ${before} to ${after} out of 100. The marketplace has been updated.`
            : "Saved. Readiness did not change, because this did not complete a missing check.",
        });
        return true;
      } catch {
        toast.push({
          tone: "error",
          title: "Nothing was changed",
          detail: "We could not reach the service. Please try again.",
        });
        return false;
      }
    },
    [load, router, state, toast],
  );

  useEffect(() => {
    if (state.phase === "idle") return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [state.phase, close]);

  const api = useMemo<InvestigationApi>(
    () => ({
      open,
      close,
      activeId: state.phase === "idle" ? null : state.assetVersionId,
    }),
    [open, close, state],
  );

  return (
    <InvestigationContext.Provider value={api}>
      {children}
      {state.phase === "idle" ? null : (
        <InvestigationDrawer state={state} onClose={close} onAction={runAction} />
      )}
    </InvestigationContext.Provider>
  );
}

export function useInvestigation(): InvestigationApi {
  return (
    useContext(InvestigationContext) ?? {
      open: () => undefined,
      close: () => undefined,
      activeId: null,
    }
  );
}
