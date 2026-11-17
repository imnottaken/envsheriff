import { type CheckResult, counts } from "./check.js";

const useColor = !process.env["NO_COLOR"] && process.stdout.isTTY === true;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const yellow = paint(33);
const green = paint(32);
const dim = paint(2);
const bold = paint(1);

function pad(s: string, n: number): string {
  return s.length >= n ? s + " " : s + " ".repeat(n - s.length);
}

export function formatText(r: CheckResult, opts: { strict?: boolean } = {}): string {
  const lines: string[] = [];
  const { errors, warnings } = counts(r);
  const example = r.exampleFile ?? "(none)";
  lines.push(
    `${bold("envguard")} ${dim(`scanned ${r.filesScanned} files · ${r.used.length} vars used · example: ${example}`)}`,
    "",
  );

  if (r.exampleFile === null && r.used.length > 0) {
    lines.push(red(`✖ No .env.example found`));
    lines.push(`  ${r.used.length} variables are read in code but undocumented.`);
    lines.push(dim(`  Run ${bold("envguard --fix")} to create one.`), "");
  } else if (r.missing.length) {
    lines.push(red(`✖ Missing from ${r.exampleFile} (${r.missing.length})`));
    const w = Math.max(...r.missing.map((m) => m.name.length)) + 2;
    for (const m of r.missing) {
      const first = m.usages[0]!;
      const more = m.usages.length > 1 ? dim(` (+${m.usages.length - 1} more)`) : "";
      lines.push(`  ${pad(m.name, w)}${dim(`${first.file}:${first.line}`)}${more}`);
    }
    lines.push("");
  }

  if (r.leaks.length) {
    lines.push(red(`✖ Possible leaks (${r.leaks.length})`));
    for (const l of r.leaks) {
      const where = l.line ? `${l.file}:${l.line}` : l.file;
      lines.push(`  ${l.message} ${dim(`(${where})`)}`);
      if (l.kind === "tracked") {
        lines.push(dim(`    fix: git rm --cached ${l.file} && echo "${l.file}" >> .gitignore — then rotate those secrets`));
      } else if (l.kind === "not-ignored") {
        lines.push(dim(`    fix: echo "${l.file}" >> .gitignore`));
      } else {
        lines.push(dim(`    fix: replace it with a placeholder, and rotate the key if it was ever pushed`));
      }
    }
    lines.push("");
  }

  if (r.unused.length) {
    lines.push(yellow(`⚠ Unused in ${r.exampleFile} (${r.unused.length})`));
    const w = Math.max(...r.unused.map((u) => u.name.length)) + 2;
    for (const u of r.unused) lines.push(`  ${pad(u.name, w)}${dim(`${r.exampleFile}:${u.line}`)}`);
    lines.push("");
  }

  if (r.duplicates.length) {
    lines.push(yellow(`⚠ Declared twice in ${r.exampleFile} (${r.duplicates.length})`));
    for (const d of r.duplicates) lines.push(`  ${d.name} ${dim(`lines ${d.lines.join(", ")}`)}`);
    lines.push("");
  }

  if (r.dynamic.length) {
    lines.push(yellow(`⚠ Dynamic access, can't be checked (${r.dynamic.length})`));
    for (const d of r.dynamic) lines.push(`  ${dim(`${d.file}:${d.line}`)}  ${d.snippet}`);
    lines.push("");
  }

  const failed = errors > 0 || (opts.strict === true && warnings > 0);
  if (errors === 0 && warnings === 0) {
    lines.push(green("✔ All env vars accounted for. No leaks found."));
  } else {
    const summary = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
    lines.push(failed ? red(`✖ ${summary}`) : yellow(`⚠ ${summary}`));
  }
  if (!r.isGitRepo) lines.push(dim("  (not a git repo: skipped .gitignore checks)"));
  return lines.join("\n");
}

export function formatJson(r: CheckResult): string {
  return JSON.stringify({ ...counts(r), ...r }, null, 2);
}
