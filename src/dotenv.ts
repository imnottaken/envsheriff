export interface DotenvEntry {
  key: string;
  value: string;
  line: number;
}

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

/**
 * Minimal .env parser: KEY=value, `export KEY=value`, quoted values,
 * inline `#` comments on unquoted values. Good enough for linting —
 * we only need keys, line numbers and (roughly) values.
 */
export function parseDotenv(src: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith("#")) continue;
    const m = LINE.exec(raw);
    if (!m) continue;
    entries.push({ key: m[1]!, value: unquote(m[2]!), line: i + 1 });
  }
  return entries;
}

function unquote(v: string): string {
  const q = v[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = v.indexOf(q, 1);
    return end === -1 ? v.slice(1) : v.slice(1, end);
  }
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}
