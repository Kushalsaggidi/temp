import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildContractArtifacts } from "./schema-artifacts";

const outputDirectory = fileURLToPath(
  new URL("../../generated/contracts/", import.meta.url),
);

await mkdir(outputDirectory, { recursive: true });

for (const [fileName, contents] of buildContractArtifacts()) {
  await writeFile(join(outputDirectory, fileName), contents, "utf8");
}

console.log(`Generated contract artifacts in ${outputDirectory}`);
