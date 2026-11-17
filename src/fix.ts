import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "./check.js";

/**
 * Append every missing variable to the example file (creating it if needed),
 * with empty values. Returns the file written and the keys added.
 */
export function fixMissing(r: CheckResult): { file: string; added: string[] } {
  const file = r.exampleFile ?? ".env.example";
  const path = join(r.root, file);
  const names = r.exampleFile ? r.missing.map((m) => m.name) : r.used;
  if (names.length === 0) return { file, added: [] };

  const block = names.map((n) => `${n}=`).join("\n") + "\n";
  if (!existsSync(path)) {
    writeFileSync(path, `# Environment variables used by this project.\n# Copy to .env and fill in real values.\n\n${block}`);
  } else {
    const current = readFileSync(path, "utf8");
    const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    appendFileSync(path, `${sep}\n# Added by envsheriff\n${block}`);
  }
  return { file, added: names };
}
