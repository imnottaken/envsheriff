import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check, counts } from "../dist/index.js";

// Fake keys are assembled from pieces so secret scanners (like GitHub push
// protection) don't mistake these test fixtures for real credentials.
const fake = (...parts) => parts.join("");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

function project(files, { git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "envsheriff-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (git) {
    const g = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    g("init", "-q");
    g("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  }
  return root;
}

const run = (root, ...args) => spawnSync("node", [CLI, root, ...args], { encoding: "utf8" });

test("clean project passes", () => {
  const root = project({
    ".env.example": "DATABASE_URL=\nAPI_KEY=\n",
    "src/a.ts": "process.env.DATABASE_URL; process.env.API_KEY; process.env.NODE_ENV;",
  });
  const r = check({ root });
  assert.deepEqual(counts(r), { errors: 0, warnings: 0 });
  assert.equal(run(root).status, 0);
});

test("missing and unused are detected", () => {
  const root = project({
    ".env.example": "USED=\nOLD_THING=\n",
    "src/a.ts": "process.env.USED; process.env.NEW_THING;",
    "worker.py": "import os\nos.getenv('PY_VAR')",
  });
  const r = check({ root });
  assert.deepEqual(r.missing.map((m) => m.name), ["NEW_THING", "PY_VAR"]);
  assert.deepEqual(r.unused.map((u) => u.name), ["OLD_THING"]);
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /NEW_THING\s+src\/a\.ts:1/);
});

test("ignore option and globs", () => {
  const root = project({
    ".env.example": "",
    "a.js": "process.env.SENTRY_DSN; process.env.SENTRY_ORG; process.env.DEBUG;",
  });
  assert.equal(check({ root, ignore: ["SENTRY_*", "DEBUG"] }).missing.length, 0);
  assert.equal(run(root, "-i", "SENTRY_*,DEBUG").status, 0);
});

test("exclude skips paths by glob", () => {
  const root = project({
    ".env.example": "APP=\n",
    "src/a.ts": "process.env.APP;",
    "test/fixtures/x.js": "process.env.FIXTURE_ONLY;",
    "src/a.spec.ts": "process.env.SPEC_ONLY;",
  });
  assert.equal(check({ root }).missing.length, 2);
  assert.equal(check({ root, exclude: ["test", "**/*.spec.ts"] }).missing.length, 0);
  assert.equal(run(root, "-x", "test/**,**/*.spec.ts").status, 0);
});

test("config file is respected", () => {
  const root = project({
    ".envsheriffrc.json": JSON.stringify({ ignore: ["SKIP_ME"], example: "config/env.example" }),
    "config/env.example": "REAL=\n",
    "a.js": "process.env.REAL; process.env.SKIP_ME;",
  });
  assert.equal(run(root).status, 0);
});

test("SDK-read vars (OpenAI, Clerk) aren't reported unused", () => {
  const root = project({ ".env.example": "OPENAI_API_KEY=\nCLERK_SECRET_KEY=\nREALLY_UNUSED=\n", "a.js": "" });
  assert.deepEqual(check({ root }).unused.map((u) => u.name), ["REALLY_UNUSED"]);
});

test("--strict fails on warnings", () => {
  const root = project({ ".env.example": "UNUSED=\n", "a.js": "" });
  assert.equal(run(root).status, 0);
  assert.equal(run(root, "--strict").status, 1);
});

test("--fix appends missing vars and then passes", () => {
  const root = project({
    ".env.example": "A=1",
    "a.js": "process.env.A; process.env.B; process.env.C;",
  });
  const res = run(root, "--fix");
  assert.equal(res.status, 0, res.stdout);
  assert.equal(readFileSync(join(root, ".env.example"), "utf8"), "A=1\n\n# Added by envsheriff\nB=\nC=\n");
});

test("--fix creates .env.example when absent", () => {
  const root = project({ "a.js": "process.env.ONLY;" });
  assert.equal(run(root).status, 1);
  assert.equal(run(root, "--fix").status, 0);
  assert.match(readFileSync(join(root, ".env.example"), "utf8"), /^ONLY=$/m);
});

test("committed .env with only defaults is fine and acts as the example", () => {
  const root = project(
    { ".env": "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/db\nNEXT_PUBLIC_X=1\n", "a.js": "process.env.DATABASE_URL; process.env.NEXT_PUBLIC_X;" },
    { git: true },
  );
  const r = check({ root });
  assert.equal(r.exampleFile, ".env");
  assert.deepEqual(counts(r), { errors: 0, warnings: 0 });
});

test("committed .env.local is always a leak", () => {
  const root = project({ ".env.local": "A=1", "a.js": "" }, { git: true });
  assert.deepEqual(check({ root }).leaks.map((l) => l.file), [".env.local"]);
});

test("leak: secret in committed .env, unignored .env.local, real key in example", () => {
  const root = project(
    {
      ".env": "STRIPE_SECRET_KEY=" + fake("sk", "_live_", "51HxQ2bC3dE4fG5hI6jK7lM8n"),
      ".env.example": "OPENAI_API_KEY=" + fake("sk-", "proj-", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z") + "\n",
      "a.js": "process.env.OPENAI_API_KEY;",
    },
    { git: true },
  );
  writeFileSync(join(root, ".env.local"), "X=1");
  const kinds = check({ root }).leaks.map((l) => l.kind).sort();
  assert.deepEqual(kinds, ["not-ignored", "secret-in-example", "tracked"]);
  assert.equal(check({ root, leaks: false }).leaks.length, 0);
});

test("gitignored .env is fine", () => {
  const root = project(
    { ".gitignore": ".env\n", ".env.example": "K=\n", "a.js": "process.env.K;" },
    { git: true },
  );
  writeFileSync(join(root, ".env"), "K=real");
  assert.equal(check({ root }).leaks.length, 0);
});

test("node_modules and gitignored files are skipped", () => {
  const root = project(
    {
      ".gitignore": "generated/\n",
      ".env.example": "",
      "node_modules/pkg/index.js": "process.env.FROM_DEP;",
      "generated/x.js": "process.env.FROM_GENERATED;",
    },
    { git: true },
  );
  assert.equal(check({ root }).used.length, 0);
});

test("--json output is parseable", () => {
  const root = project({ ".env.example": "", "a.js": "process.env.X;" });
  const json = JSON.parse(run(root, "--json").stdout);
  assert.equal(json.errors, 1);
  assert.equal(json.missing[0].name, "X");
});

test("bad flags exit 2", () => {
  assert.equal(spawnSync("node", [CLI, "--nope"], { encoding: "utf8" }).status, 2);
});
