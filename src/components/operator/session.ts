"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import type { OperatorContext, OperatorResponse } from "@/contracts";

export interface OperatorEntry {
  id: string;
  utterance: string;
  /** "action" entries are the result of a confirmed write, not a question. */
  origin: "request" | "action";
  status: "running" | "ready" | "error";
  response: OperatorResponse | null;
  error: string | null;
}

function entryId(): string {
  return `entry_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function post(path: string, body: unknown): Promise<OperatorResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || payload === null) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (payload as { error: { message: string } }).error.message
        : "The operator could not complete that. Nothing was changed.";
    throw new Error(message);
  }
  return payload as OperatorResponse;
}

/**
 * One operator conversation. It holds the turns, the asset the conversation is
 * currently about, and the two request paths: reading, and performing a write
 * the person has already confirmed.
 */
export function useOperatorSession(context: OperatorContext) {
  const router = useRouter();
  const [entries, setEntries] = useState<OperatorEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const focus = useRef<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    inflight.current?.abort();
    setEntries([]);
    setBusy(false);
    focus.current = null;
  }, []);

  const push = useCallback((entry: OperatorEntry) => {
    setEntries((current) => [...current, entry]);
  }, []);

  const settle = useCallback(
    (id: string, update: Partial<OperatorEntry>) => {
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, ...update } : entry)),
      );
    },
    [],
  );

  const run = useCallback(
    async (utterance: string): Promise<OperatorResponse | null> => {
      const trimmed = utterance.trim();
      if (trimmed.length === 0 || busy) return null;
      const id = entryId();
      push({
        id,
        utterance: trimmed,
        origin: "request",
        status: "running",
        response: null,
        error: null,
      });
      setBusy(true);
      try {
        const response = await post("/api/operator", {
          utterance: trimmed,
          context,
          ...(focus.current === null ? {} : { focus_asset_version_id: focus.current }),
        });
        focus.current =
          response.understanding.resolved_asset?.asset_version_id ?? focus.current;
        settle(id, { status: "ready", response });
        return response;
      } catch (cause) {
        settle(id, {
          status: "error",
          error:
            cause instanceof Error && cause.message
              ? cause.message
              : "The operator could not complete that. Nothing was changed.",
        });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, context, push, settle],
  );

  /** Performs a write the person has explicitly approved, then reports it. */
  const act = useCallback(
    async (
      tool: string,
      args: Record<string, unknown>,
      label: string,
    ): Promise<OperatorResponse | null> => {
      if (busy) return null;
      const id = entryId();
      push({
        id,
        utterance: label,
        origin: "action",
        status: "running",
        response: null,
        error: null,
      });
      setBusy(true);
      try {
        const response = await post("/api/operator/act", {
          tool,
          args,
          context,
          confirmed: true,
        });
        settle(id, { status: "ready", response });
        // Server components elsewhere read the same records; keep them honest.
        router.refresh();
        return response;
      } catch (cause) {
        settle(id, {
          status: "error",
          error:
            cause instanceof Error && cause.message
              ? cause.message
              : "Nothing was changed.",
        });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, context, push, router, settle],
  );

  /** Builds an action preview without performing anything. */
  const preview = useCallback(
    async (tool: string, args: Record<string, unknown>): Promise<OperatorResponse | null> => {
      try {
        return await post("/api/operator/preview", { tool, args, context });
      } catch {
        return null;
      }
    },
    [context],
  );

  const dismiss = useCallback(
    (id: string) => {
      setEntries((current) => current.filter((entry) => entry.id !== id));
    },
    [],
  );

  return {
    entries,
    busy,
    run,
    act,
    preview,
    reset,
    dismiss,
    setBusy,
    focusAssetVersionId: focus,
  };
}

export type OperatorSession = ReturnType<typeof useOperatorSession>;
