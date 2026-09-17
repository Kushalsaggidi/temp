import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildContractArtifacts } from "./schema-artifacts";

const outputDirectory = fileURLToPath(
  new URL("../../generated/contracts/", import.meta.url),
);
const staleFiles: string[] = [];

for (const [fileName, expected] of buildContractArtifacts()) {
  let actual: string | undefined;
  try {
    actual = await readFile(join(outputDirectory, fileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (actual !== expected) {
    staleFiles.push(fileName);
  }
}

if (staleFiles.length > 0) {
  console.error(
    `Contract artifacts are missing or stale: ${staleFiles.join(", ")}. Run npm run contracts:generate.`,
  );
  process.exitCode = 1;
} else {
  console.log("Committed contract artifacts match the executable Zod schemas.");
}
