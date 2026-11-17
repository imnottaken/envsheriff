import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_IGNORE, EXAMPLE_CANDIDATES, IMPLICITLY_READ, matcher, pathMatcher } from "./config.js";
import { parseDotenv } from "./dotenv.js";
import { type DynamicAccess, type Usage, SUPPORTED_EXTENSIONS, extract, langFor } from "./extract.js";
import { gitTrackedFiles, isGitIgnored, isGitRepo, listFiles } from "./files.js";
import { detectSecret } from "./secrets.js";

export interface CheckOptions {
  root: string;
  example?: string;
  ignore?: string[];
  exclude?: string[];
  leaks?: boolean;
}

export interface Leak {
  kind: "tracked" | "not-ignored" | "secret-in-example";
  file: string;
  line?: number;
  message: string;
}

export interface CheckResult {
  root: string;
  exampleFile: string | null;
  filesScanned: number;
  isGitRepo: boolean;
  /** Read in code but absent from the example file. */
  missing: Array<{ name: string; usages: Usage[] }>;
  /** Declared in the example file but never read in code. */
  unused: Array<{ name: string; line: number }>;
  /** Declared more than once in the example file. */
  duplicates: Array<{ name: string; lines: number[] }>;
  leaks: Leak[];
  /** Reads like process.env[key] that can't be checked statically. */
  dynamic: DynamicAccess[];
  /** Every variable name found in code. */
  used: string[];
}

const ENV_FILE = /^\.env(\.[\w.-]+)?$/;
const EXAMPLE_LIKE = /(example|sample|template|dist|defaults)/i;

export function isRealEnvFile(name: string): boolean {
  return ENV_FILE.test(name) && !EXAMPLE_LIKE.test(name);
}

export function findExample(root: string, explicit?: string): string | null {
  if (explicit) return explicit;
  return EXAMPLE_CANDIDATES.find((c) => existsSync(join(root, c))) ?? null;
}

export function check(opts: CheckOptions): CheckResult {
  const root = opts.root;
  const ignored = matcher([...DEFAULT_IGNORE, ...(opts.ignore ?? [])]);
  const implicit = matcher(IMPLICITLY_READ);
  const repo = isGitRepo(root);

  // 1. Find every env read in source.
  const excluded = pathMatcher(opts.exclude ?? []);
  const files = listFiles(
    root,
    (f) => SUPPORTED_EXTENSIONS.has(extOf(f)) && !!langFor(f) && !excluded(f),
  );
  const usages: Usage[] = [];
  const dynamic: DynamicAccess[] = [];
  for (const f of files) {
    const res = extract(f, readFileSync(join(root, f), "utf8"));
    usages.push(...res.usages);
    dynamic.push(...res.dynamic);
  }
  const byName = new Map<string, Usage[]>();
  for (const u of usages) {
    if (ignored(u.name)) continue;
    const list = byName.get(u.name) ?? [];
    list.push(u);
    byName.set(u.name, list);
  }

  // 2. Read the example file. With no example file, a committed .env of
  //    defaults (the Next.js convention) serves as the documentation instead.
  const tracked = repo ? gitTrackedFiles(root).filter((f) => isRealEnvFile(basename(f))) : [];
  const exampleFile =
    findExample(root, opts.example) ?? (tracked.includes(".env") ? ".env" : null);
  const examplePath = exampleFile ? join(root, exampleFile) : null;
  const entries = examplePath && existsSync(examplePath)
    ? parseDotenv(readFileSync(examplePath, "utf8"))
    : [];
  const declared = new Map<string, number[]>();
  for (const e of entries) declared.set(e.key, [...(declared.get(e.key) ?? []), e.line]);

  // 3. Compare.
  const missing = [...byName.entries()]
    .filter(([name]) => !declared.has(name))
    .map(([name, us]) => ({ name, usages: us }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const unused = [...declared.entries()]
    .filter(([name]) => !byName.has(name) && !ignored(name) && !implicit(name))
    .map(([name, lines]) => ({ name, line: lines[0]! }))
    .sort((a, b) => a.line - b.line);

  const duplicates = [...declared.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([name, lines]) => ({ name, lines }));

  // 4. Leaks.
  const leaks: Leak[] = [];
  if (opts.leaks !== false) {
    if (exampleFile && !tracked.includes(exampleFile)) {
      for (const e of entries) {
        const label = detectSecret(e.key, e.value);
        if (label) {
          leaks.push({
            kind: "secret-in-example",
            file: exampleFile,
            line: e.line,
            message: `${e.key} looks like a real ${label}`,
          });
        }
      }
    }
    if (repo) {
      // Committing a .env of harmless defaults is a legit convention (Next.js does it),
      // so a tracked env file only counts as a leak if it's a *.local file or
      // actually contains something that looks like a secret.
      for (const f of tracked) {
        if (/\.local$/.test(f)) {
          leaks.push({ kind: "tracked", file: f, message: `${f} is committed to git (.local files are meant to stay private)` });
          continue;
        }
        let src = "";
        try {
          src = readFileSync(join(root, f), "utf8");
        } catch {
          continue;
        }
        for (const e of parseDotenv(src)) {
          const label = detectSecret(e.key, e.value);
          if (label) {
            leaks.push({ kind: "tracked", file: f, line: e.line, message: `${e.key} in committed ${f} looks like a real ${label}` });
          }
        }
      }
      const trackedSet = new Set(tracked);
      for (const name of readdirSync(root)) {
        if (!isRealEnvFile(name) || trackedSet.has(name)) continue;
        if (!isGitIgnored(root, name)) {
          leaks.push({ kind: "not-ignored", file: name, message: `${name} is not in .gitignore` });
        }
      }
    }
  }

  return {
    root,
    exampleFile,
    filesScanned: files.length,
    isGitRepo: repo,
    missing,
    unused,
    duplicates,
    leaks,
    dynamic,
    used: [...byName.keys()].sort(),
  };
}

function extOf(f: string): string {
  const i = f.lastIndexOf(".");
  return i === -1 ? "" : f.slice(i).toLowerCase();
}

export function counts(r: CheckResult): { errors: number; warnings: number } {
  const noExample = r.exampleFile === null && r.used.length > 0 ? 1 : 0;
  return {
    errors: (r.exampleFile ? r.missing.length : 0) + noExample + r.leaks.length,
    warnings: r.unused.length + r.duplicates.length + r.dynamic.length,
  };
}
