import { describe, it } from "vitest";

import { verifyPublicReuse } from "../../scripts/execution/verify-public-reuse";

const live = process.env.RUN_PUBLIC_REUSE_VERIFICATION === "1";

describe.skipIf(!live)("live postpublication public UI/API reuse", () => {
  it("runs both scenarios through the locally served public paths", async () => {
    await verifyPublicReuse();
  });
});

