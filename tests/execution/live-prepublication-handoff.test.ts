import { describe, it } from "vitest";

import { runPrepublicationReuse } from "../../scripts/execution/run-prepublication-reuse";

const live = process.env.RUN_PREPUBLICATION_EVIDENCE === "1";

describe.skipIf(!live)("live frozen-subject prepublication handoff", () => {
  it("runs both canonical scenarios and emits governed evidence candidates", async () => {
    await runPrepublicationReuse();
  });
});

