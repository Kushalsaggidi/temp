import { existsSync, mkdirSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const DATA_DIRECTORY = resolve(PROJECT_ROOT, "data");
export const DEFAULT_DATABASE_PATH = resolve(
  DATA_DIRECTORY,
  "marketplace.sqlite",
);

export function resolveDatabasePath(path = process.env.DATABASE_PATH): string {
  if (!path) {
    return DEFAULT_DATABASE_PATH;
  }

  return isAbsolute(path) ? resolve(path) : resolve(PROJECT_ROOT, path);
}

export function assertSafeResetPath(path: string): string {
  const resolvedPath = resolve(path);
  const hasSqliteExtension = /\.(?:sqlite|sqlite3|db)$/i.test(resolvedPath);
  const lexicalPathFromDataDirectory = relative(DATA_DIRECTORY, resolvedPath);
  const isLexicallyInsideDataDirectory =
    lexicalPathFromDataDirectory.length > 0 &&
    lexicalPathFromDataDirectory !== ".." &&
    !lexicalPathFromDataDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(lexicalPathFromDataDirectory);

  if (!isLexicallyInsideDataDirectory || !hasSqliteExtension) {
    throw new Error(
      `Refusing to reset unsafe database path: ${resolvedPath}. ` +
        `Reset targets must be SQLite files below ${DATA_DIRECTORY}.`,
    );
  }

  mkdirSync(DATA_DIRECTORY, { recursive: true });
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const canonicalDataDirectory = realpathSync.native(DATA_DIRECTORY);
  const canonicalPath = existsSync(resolvedPath)
    ? realpathSync.native(resolvedPath)
    : resolve(realpathSync.native(dirname(resolvedPath)), basename(resolvedPath));
  const canonicalPathFromDataDirectory = relative(
    canonicalDataDirectory,
    canonicalPath,
  );
  const isCanonicallyInsideDataDirectory =
    canonicalPathFromDataDirectory.length > 0 &&
    canonicalPathFromDataDirectory !== ".." &&
    !canonicalPathFromDataDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(canonicalPathFromDataDirectory);

  if (!isCanonicallyInsideDataDirectory) {
    throw new Error(
      `Refusing to reset unsafe database path: ${resolvedPath}. ` +
        `The resolved target must remain below ${canonicalDataDirectory}.`,
    );
  }

  return canonicalPath;
}
