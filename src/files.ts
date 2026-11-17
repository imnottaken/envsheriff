import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".vercel", ".output", "coverage", "vendor", "target",
  "venv", ".venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache",
]);

const VENDORED_DIRS = new Set(["node_modules", "bower_components", "vendor", "venv", ".venv", "site-packages"]);

const MAX_FILE_BYTES = 1_000_000;

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export function isGitRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
}

/** Files git tracks, relative to root (posix separators). */
export function gitTrackedFiles(root: string): string[] {
  const out = git(root, ["ls-files", "-z", "--cached"]);
  return out ? out.split("\0").filter(Boolean) : [];
}

/** True if git would ignore this path. */
export function isGitIgnored(root: string, path: string): boolean {
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", path], { stdio: "ignore" });
    return true; // exit 0 → ignored
  } catch {
    return false; // exit 1 → not ignored
  }
}

/**
 * List candidate source files under root. In a git repo we ask git
 * (respects .gitignore); otherwise we walk the tree skipping the usual
 * dependency/build folders.
 */
export function listFiles(root: string, accept: (file: string) => boolean): string[] {
  const fromGit = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  let files: string[];
  if (fromGit !== null) {
    // Even inside git, never scan vendored dependencies someone committed.
    files = fromGit
      .split("\0")
      .filter((f) => f && !f.split("/").some((seg) => VENDORED_DIRS.has(seg)));
  } else {
    files = [];
    walk(root, root, files);
  }
  return files
    .filter((f) => accept(f) && !/\.min\.[cm]?js$/.test(f))
    .filter((f) => {
      try {
        const st = statSync(join(root, f));
        return st.isFile() && st.size <= MAX_FILE_BYTES;
      } catch {
        return false; // deleted but still in the index
      }
    })
    .sort();
}

function walk(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) walk(root, join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(relative(root, join(dir, e.name)).split(sep).join("/"));
    }
  }
}
