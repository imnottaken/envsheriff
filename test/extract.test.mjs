import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "../dist/index.js";

const names = (file, src) => [...new Set(extract(file, src).usages.map((u) => u.name))].sort();

test("JS/TS: dot, bracket, import.meta, Bun, Deno", () => {
  const src = `
    const a = process.env.DATABASE_URL;
    const b = process.env["STRIPE_KEY"];
    const c = process.env['REDIS_URL'];
    const d = import.meta.env.VITE_API_URL;
    const e = Bun.env.BUN_TOKEN;
    const f = Deno.env.get("DENO_TOKEN");
  `;
  assert.deepEqual(names("a.ts", src), [
    "BUN_TOKEN", "DATABASE_URL", "DENO_TOKEN", "REDIS_URL", "STRIPE_KEY", "VITE_API_URL",
  ]);
});

test("JS: destructuring with alias, default and rest", () => {
  const src = `const { API_KEY, SECRET: s, PORT = "3000", ...rest } = process.env;`;
  assert.deepEqual(names("a.js", src), ["API_KEY", "PORT", "SECRET"]);
});

test("JS: dynamic access is reported separately", () => {
  const r = extract("a.js", "const k = 'X';\nconst v = process.env[k];\nprocess.env[`A_${k}`];");
  assert.equal(r.usages.length, 0);
  assert.equal(r.dynamic.length, 2);
  assert.equal(r.dynamic[0].line, 2);
});

test("Python: os.environ, .get, getenv, bare environ", () => {
  const src = `
import os
from os import environ, getenv
a = os.environ["A"]
b = os.environ.get('B', 'x')
c = os.getenv("C")
d = environ["D"]
e = getenv('E')
`;
  assert.deepEqual(names("app.py", src), ["A", "B", "C", "D", "E"]);
});

test("Go, Ruby, Rust, PHP", () => {
  assert.deepEqual(names("m.go", `os.Getenv("G1"); os.LookupEnv("G2")`), ["G1", "G2"]);
  assert.deepEqual(names("m.rb", `ENV["R1"]; ENV.fetch('R2')`), ["R1", "R2"]);
  assert.deepEqual(names("m.rs", `env::var("S1"); std::env::var_os("S2"); env!("S3")`), ["S1", "S2", "S3"]);
  assert.deepEqual(names("m.php", `getenv('P1'); $_ENV["P2"]; env('P3'); $x->env('NOPE');`), ["P1", "P2", "P3"]);
});

test("Prisma schema env()", () => {
  const src = `datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}`;
  assert.deepEqual(names("prisma/schema.prisma", src), ["DATABASE_URL", "DIRECT_URL"]);
});

test("whole-line comments are ignored, line numbers preserved", () => {
  const js = `// process.env.COMMENTED\n/**\n * e.g. process.env.IN_JSDOC\n */\nconst x = process.env.REAL; // trailing ok\n`;
  const r = extract("a.ts", js);
  assert.deepEqual(r.usages.map((u) => [u.name, u.line]), [["REAL", 5]]);
  assert.deepEqual(names("a.py", `# os.getenv("OLD")\nos.getenv("NEW")`), ["NEW"]);
  // Rust attributes start with # but aren't comments
  assert.deepEqual(names("m.rs", `#[cfg(test)]\nlet x = env::var("RS");`), ["RS"]);
});

test("line numbers are 1-based and correct", () => {
  const r = extract("a.js", "\n\nconst x = process.env.LINE_THREE;");
  assert.equal(r.usages[0].line, 3);
});

test("unsupported files yield nothing", () => {
  assert.deepEqual(extract("README.md", "process.env.NOPE").usages, []);
});
