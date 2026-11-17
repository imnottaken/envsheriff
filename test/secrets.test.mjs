import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSecret, parseDotenv } from "../dist/index.js";

// Fake keys are assembled from pieces so secret scanners (like GitHub push
// protection) don't mistake these test fixtures for real credentials.
const fake = (...parts) => parts.join("");

test("flags real-looking keys", () => {
  assert.equal(detectSecret("OPENAI_API_KEY", fake("sk-", "proj-", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z")), "OpenAI API key");
  assert.equal(detectSecret("ANTHROPIC_API_KEY", fake("sk-", "ant-", "api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2")), "Anthropic API key");
  assert.equal(detectSecret("GH", fake("gh", "p_", "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2")), "GitHub token");
  assert.equal(detectSecret("AWS_ACCESS_KEY_ID", fake("AK", "IA", "IOSFODNN7ABCDEFG")), "AWS access key ID");
  assert.equal(detectSecret("RZP", fake("rzp", "_live_", "Q1w2E3r4T5y6U7")), "Razorpay live key");
  assert.equal(
    detectSecret("DATABASE_URL", "postgres://app:Xk29fLq8Zm47Wp@db.prod.internal:5432/app"),
    "password in connection string",
  );
  assert.equal(detectSecret("JWT_SECRET", "q8Zf3kL9mX2vB7nR4tY1wE6uI0oP5aS"), "high-entropy secret");
});

test("ignores placeholders and harmless values", () => {
  for (const [k, v] of [
    ["OPENAI_API_KEY", "sk-your-key-here"],
    ["OPENAI_API_KEY", ""],
    ["STRIPE_KEY", "sk_test_xxxxxxxxxxxxxxxxxxxx"],
    ["DATABASE_URL", "postgres://user:password@localhost:5432/app"],
    ["API_URL", "https://api.example.com/v1/some/long/path"],
    ["JWT_SECRET", "<generate with openssl rand -hex 32>"],
    ["APP_NAME", "my-cool-application-name-here"],
  ]) {
    assert.equal(detectSecret(k, v), null, `${k}=${v}`);
  }
});

test("dotenv parser handles export, quotes, comments", () => {
  const entries = parseDotenv(`
# comment
export A=1
B="two # not a comment"
C='three'
D=four # trailing comment
E=
not a line
`);
  assert.deepEqual(
    entries.map((e) => [e.key, e.value]),
    [["A", "1"], ["B", "two # not a comment"], ["C", "three"], ["D", "four"], ["E", ""]],
  );
  assert.equal(entries[0].line, 3);
});
