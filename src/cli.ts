#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { check, counts } from "./check.js";
import { loadConfig } from "./config.js";
import { fixMissing } from "./fix.js";
import { formatJson, formatText } from "./report.js";

const HELP = `envguard: catch missing, unused and leaked env vars

Usage
  envguard [dir] [options]

Options
  -e, --example <file>   Example file to compare against (default: auto-detect .env.example)
  -i, --ignore <names>   Comma-separated names or globs to skip, e.g. "SENTRY_*,DEBUG"
  -x, --exclude <paths>  Comma-separated path globs not to scan, e.g. "test/**,scripts"
      --fix              Add missing variables to the example file
      --json             Machine-readable output
      --strict           Fail on warnings too (unused, duplicates, dynamic access)
      --no-leaks         Skip leak checks
  -h, --help             Show this help
  -v, --version          Show version

Config
  Put the same options in .envguardrc.json or an "envguard" key in package.json:
  { "example": ".env.example", "ignore": ["SENTRY_*"], "strict": false }

Exit codes
  0 clean · 1 problems found · 2 bad usage`;

function version(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

function main(): number {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        example: { type: "string", short: "e" },
        ignore: { type: "string", short: "i", multiple: true },
        exclude: { type: "string", short: "x", multiple: true },
        fix: { type: "boolean" },
        json: { type: "boolean" },
        strict: { type: "boolean" },
        "no-leaks": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    console.error(`envguard: ${(err as Error).message}\nRun envguard --help for usage.`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) return console.log(HELP), 0;
  if (values.version) return console.log(version()), 0;
  if (positionals.length > 1) {
    console.error("envguard: pass at most one directory");
    return 2;
  }

  const root = resolve(positionals[0] ?? ".");
  let config;
  try {
    config = loadConfig(root);
  } catch (err) {
    console.error(`envguard: couldn't read config: ${(err as Error).message}`);
    return 2;
  }

  const list = (xs?: string[]) =>
    (xs ?? []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  const ignore = [...(config.ignore ?? []), ...list(values.ignore)];
  const exclude = [...(config.exclude ?? []), ...list(values.exclude)];
  const strict = values.strict ?? config.strict ?? false;
  const opts = {
    root,
    example: values.example ?? config.example,
    ignore,
    exclude,
    leaks: values["no-leaks"] ? false : config.leaks ?? true,
  };

  let result = check(opts);

  if (values.fix) {
    const { file, added } = fixMissing(result);
    if (!values.json) {
      console.log(added.length ? `Added ${added.length} variable(s) to ${file}: ${added.join(", ")}\n` : "Nothing to fix.\n");
    }
    result = check(opts); // re-check so the report reflects the fixed file
  }

  console.log(values.json ? formatJson(result) : formatText(result, { strict }));
  const { errors, warnings } = counts(result);
  return errors > 0 || (strict && warnings > 0) ? 1 : 0;
}

process.exitCode = main();
