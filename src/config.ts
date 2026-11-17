import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  /** Path to the example file, relative to root. Auto-detected if omitted. */
  example?: string;
  /** Extra variable names (or globs like "VERCEL_*") to never report. */
  ignore?: string[];
  /** Path globs to skip when scanning code, e.g. "test/**", "**\/*.spec.ts". */
  exclude?: string[];
  /** Treat warnings (unused, dynamic access) as failures. */
  strict?: boolean;
  /** Run leak checks. Default true. */
  leaks?: boolean;
}

/** Variables set by runtimes/platforms that nobody puts in .env.example. */
export const DEFAULT_IGNORE = [
  "NODE_ENV", "CI", "HOME", "PATH", "PWD", "USER", "SHELL", "TZ", "LANG", "TERM",
  "TMPDIR", "HOSTNAME", "PORT", "NO_COLOR", "FORCE_COLOR", "NEXT_RUNTIME", "NEXT_PHASE", "VERCEL", "VERCEL_*",
  "GITHUB_*", "RUNNER_*", "npm_*",
  // Vite built-ins on import.meta.env
  "DEV", "PROD", "MODE", "SSR", "BASE_URL",
];

/**
 * Variables that popular SDKs read on their own, so they legitimately
 * appear in .env.example without ever showing up in your code.
 * These are never reported as "unused".
 */
export const IMPLICITLY_READ = [
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_GATEWAY_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GROQ_API_KEY",
  "CLERK_*", "NEXT_PUBLIC_CLERK_*",
  "NEXTAUTH_URL", "NEXTAUTH_SECRET", "AUTH_SECRET", "AUTH_URL", "AUTH_TRUST_HOST",
  "AUTH_GITHUB_*", "AUTH_GOOGLE_*",
  "SENTRY_*", "NEXT_PUBLIC_SENTRY_*",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
  "POSTGRES_*", "KV_*", "BLOB_READ_WRITE_TOKEN", "EDGE_CONFIG",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "TURSO_*", "PRISMA_*", "DEBUG", "NEXT_TELEMETRY_DISABLED",
];

export const EXAMPLE_CANDIDATES = [
  ".env.example", ".env.sample", ".env.template", ".env.dist", "example.env",
];

export function loadConfig(root: string): Config {
  const rc = join(root, ".envguardrc.json");
  if (existsSync(rc)) return JSON.parse(readFileSync(rc, "utf8")) as Config;
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const json = JSON.parse(readFileSync(pkg, "utf8")) as { envguard?: Config };
      if (json.envguard) return json.envguard;
    } catch {
      /* malformed package.json isn't our problem */
    }
  }
  return {};
}

/** Path glob matcher: `*` stays within a segment, `**` crosses segments. A bare dir matches everything under it. */
export function pathMatcher(globs: string[]): (path: string) => boolean {
  const res = globs.map((g) => {
    const clean = g.replace(/^\.\//, "").replace(/\/$/, "");
    const body = clean
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")
      .replace(/\*\*/g, "\u0001")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    return new RegExp(`^${body}(?:/.*)?$`);
  });
  return (path) => res.some((re) => re.test(path));
}

export function matcher(patterns: string[]): (name: string) => boolean {
  const exact = new Set<string>();
  const globs: RegExp[] = [];
  for (const p of patterns) {
    if (p.includes("*")) {
      const re = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      globs.push(new RegExp(`^${re}$`));
    } else exact.add(p);
  }
  return (name) => exact.has(name) || globs.some((g) => g.test(name));
}
