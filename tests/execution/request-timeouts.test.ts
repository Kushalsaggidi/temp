import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_REUSE_FETCH_TIMEOUT_MS,
  withPublicFetchDeadline,
} from "../../scripts/execution/verify-public-reuse";

describe("execution request deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a hanging public verification request at its bounded deadline", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;

    const pending = withPublicFetchDeadline(
      "running a public scenario",
      (signal) => {
        observedSignal = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const rejection = expect(pending).rejects.toThrow(
      "Public verification timed out while running a public scenario.",
    );

    await vi.advanceTimersByTimeAsync(PUBLIC_REUSE_FETCH_TIMEOUT_MS);

    await rejection;
    expect(observedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the public verification deadline after a successful request", async () => {
    vi.useFakeTimers();

    await expect(
      withPublicFetchDeadline("loading the public Try UI", async () => "ok"),
    ).resolves.toBe("ok");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives browser execution requests a cleaned-up deadline and safe timeout message", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/execution/try-result-provenance.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("EXECUTION_REQUEST_TIMEOUT_MS = 10_000");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("clearTimeout(deadline)");
    expect(source).toContain("This took too long, so we stopped it.");
    expect(source).not.toContain("response.json().catch(() => null)");
  });
});
