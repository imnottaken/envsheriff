# envsheriff

**Catch missing, unused and leaked environment variables before they break production.**

You add `process.env.REDIS_URL` to the code, forget to put it in `.env.example`, and your teammate's app crashes on boot. Or someone pastes a real API key into `.env.example` and pushes it. `envsheriff` catches both in one command.

```console
$ npx envsheriff

envsheriff scanned 3 files · 4 vars used · example: .env.example

✖ Missing from .env.example (1)
  REDIS_URL  worker.py:2

✖ Possible leaks (2)
  RAZORPAY_KEY_SECRET looks like a real Razorpay live key (.env.example:3)
    fix: replace it with a placeholder, and rotate the key if it was ever pushed
  .env is not in .gitignore (.env)
    fix: echo ".env" >> .gitignore

⚠ Unused in .env.example (1)
  OLD_MAILGUN_KEY  .env.example:4

⚠ Dynamic access, can't be checked (1)
  src/pay.ts:2  process.env[`FEATURE_${name}`]

✖ 3 errors, 2 warnings
```

Zero dependencies. Works on any repo, any size.

## What it checks

| Check | Severity | Example |
| --- | --- | --- |
| **Missing**: read in code, not documented in `.env.example` | error | `process.env.REDIS_URL` with no `REDIS_URL=` line |
| **Leaked secret** in `.env.example` | error | `OPENAI_API_KEY=sk-proj-…` (a real key, not a placeholder) |
| **Committed secrets**: a tracked `.env*` file containing real keys, or any tracked `.env*.local` | error | `git add .env` with a live Stripe key inside |
| **Unprotected `.env`**: exists but isn't in `.gitignore` | error | one `git add .` away from a leak |
| **Unused**: in `.env.example`, never read | warning | leftovers from a removed feature |
| **Duplicates** in `.env.example` | warning | `API_KEY=` declared twice |
| **Dynamic access**: can't be checked statically | warning | `process.env[key]` |

Secret detection knows OpenAI, Anthropic, GitHub, AWS, Stripe, Razorpay, Slack, Google, JWTs, private keys and passwords in connection strings, plus a high-entropy fallback for keys named like `*_SECRET` / `*_TOKEN`. Obvious placeholders (`your-key-here`, `xxx`, `<...>`, `changeme`) are ignored.

## Languages

| Language | Patterns |
| --- | --- |
| JS / TS / Vue / Svelte / Astro | `process.env.X`, `process.env["X"]`, `const { X } = process.env`, `import.meta.env.X`, `Bun.env.X`, `Deno.env.get("X")` |
| Python | `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")` |
| Go | `os.Getenv("X")`, `os.LookupEnv("X")` |
| Ruby | `ENV["X"]`, `ENV.fetch("X")` |
| Rust | `env::var("X")`, `env!("X")` |
| PHP | `getenv('X')`, `$_ENV['X']`, `env('X')` |
| Prisma | `env("DATABASE_URL")` in `schema.prisma` |

In a git repo it scans exactly what git sees, so `.gitignore` is respected. Outside git it skips `node_modules`, `dist`, `.next`, `venv` and friends.

## Usage

```bash
npx envsheriff                  # check the current directory
npx envsheriff ./apps/web       # check a subfolder (monorepos)
npx envsheriff --fix            # add missing vars to .env.example
npx envsheriff --json           # machine-readable output
npx envsheriff --strict         # fail on warnings too
npx envsheriff -i "SENTRY_*,DEBUG"   # ignore variable names or globs
npx envsheriff -x "test/**,scripts"  # skip paths when scanning
```

Exit code `0` means clean, `1` means problems found, `2` means bad usage, so it drops straight into CI or a pre-commit hook.

### Config

Put options in `.envsheriffrc.json` (or an `"envsheriff"` key in `package.json`):

```json
{
  "example": ".env.example",
  "ignore": ["SENTRY_*", "LOCAL_ONLY_FLAG"],
  "exclude": ["test/**", "**/*.spec.ts"],
  "strict": false
}
```

Runtime and platform variables (`NODE_ENV`, `PORT`, `CI`, `VERCEL_*`, Vite's `MODE`/`DEV`…) are ignored by default. Variables that SDKs read on their own (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CLERK_*`, `NEXTAUTH_SECRET`, `AWS_*`…) are never flagged as unused.

No `.env.example`, but a committed `.env` of defaults (the Next.js convention)? envsheriff uses that as the source of truth instead.

### GitHub Action

```yaml
# .github/workflows/env.yml
name: env
on: [push, pull_request]
jobs:
  envsheriff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: imnottaken/envsheriff@v0
        with:
          args: --strict
```

Or simply `- run: npx envsheriff` in any existing workflow.

### Pre-commit hook

```bash
# .husky/pre-commit
npx envsheriff
```

### As a library

```ts
import { check, formatText } from "envsheriff";

const result = check({ root: process.cwd() });
console.log(result.missing.map((m) => m.name));
```

## How it works

1. Lists source files (via `git ls-files` when possible).
2. Runs per-language regexes over each file to find env reads, with line numbers.
3. Parses `.env.example` and diffs the two sets.
4. Checks env files against git (`ls-files`, `check-ignore`) and runs secret detection on their values.

It's regex-based rather than a full parser: fast and dependency-free, at the cost of also counting reads that sit inside comments.

## Roadmap

- [ ] Monorepo mode: check every package with its own `.env.example`
- [ ] Type generation (`env.d.ts`) from `.env.example`
- [ ] Validate `.env` against `.env.example` on your machine (`envsheriff local`)
- [ ] Java, C#, Elixir support

## Contributing

```bash
git clone https://github.com/imnottaken/envsheriff
cd envsheriff && npm install
npm test
```

## License

MIT
