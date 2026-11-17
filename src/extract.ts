import { extname } from "node:path";

/** One place in the code where an env var is read. */
export interface Usage {
  name: string;
  file: string;
  line: number;
}

/** An env read whose name can't be known statically, e.g. process.env[key]. */
export interface DynamicAccess {
  file: string;
  line: number;
  snippet: string;
}

export interface Extraction {
  usages: Usage[];
  dynamic: DynamicAccess[];
}

type Lang = "js" | "py" | "go" | "rb" | "rs" | "php" | "prisma";

const EXT_TO_LANG: Record<string, Lang> = {
  ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js",
  ".vue": "js", ".svelte": "js", ".astro": "js",
  ".py": "py",
  ".go": "go",
  ".rb": "rb",
  ".rs": "rs",
  ".php": "php",
  ".prisma": "prisma",
};

export const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_TO_LANG));

export function langFor(file: string): Lang | undefined {
  return EXT_TO_LANG[extname(file).toLowerCase()];
}

const ID = "([A-Za-z_][A-Za-z0-9_]*)";
const Q = "[\"'`]";

/** Regexes whose first capture group is the variable name. */
const STATIC_PATTERNS: Record<Lang, RegExp[]> = {
  js: [
    new RegExp(`\\bprocess\\.env\\.${ID}`, "g"),
    new RegExp(`\\bimport\\.meta\\.env\\.${ID}`, "g"),
    new RegExp(`\\bBun\\.env\\.${ID}`, "g"),
    new RegExp(`\\bDeno\\.env\\.get\\(\\s*${Q}${ID}${Q}\\s*\\)`, "g"),
  ],
  py: [
    new RegExp(`\\benviron\\[\\s*["']${ID}["']\\s*\\]`, "g"),
    new RegExp(`\\benviron\\.(?:get|pop|setdefault)\\(\\s*["']${ID}["']`, "g"),
    new RegExp(`\\bgetenv\\(\\s*["']${ID}["']`, "g"),
  ],
  go: [new RegExp(`\\bos\\.(?:Getenv|LookupEnv)\\(\\s*"${ID}"`, "g")],
  rb: [
    new RegExp(`\\bENV\\[\\s*["']${ID}["']\\s*\\]`, "g"),
    new RegExp(`\\bENV\\.fetch\\(\\s*["']${ID}["']`, "g"),
  ],
  rs: [
    new RegExp(`\\benv::var(?:_os)?\\(\\s*"${ID}"`, "g"),
    new RegExp(`\\b(?:option_)?env!\\(\\s*"${ID}"`, "g"),
  ],
  php: [
    new RegExp(`\\bgetenv\\(\\s*["']${ID}["']`, "g"),
    new RegExp(`\\$_(?:ENV|SERVER)\\[\\s*["']${ID}["']\\s*\\]`, "g"),
    new RegExp(`(?<![\\w>:$])env\\(\\s*["']${ID}["']`, "g"),
  ],
  prisma: [new RegExp(`\\benv\\(\\s*"${ID}"\\s*\\)`, "g")],
};

/** JS bracket access: process.env[...] / import.meta.env[...] / Bun.env[...] */
const JS_BRACKET = /\b(process\.env|import\.meta\.env|Bun\.env)\[\s*([^\]\n]*?)\s*\]/g;
const STATIC_KEY = /^["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]$/;

/** JS destructuring: const { A, B: b, C = "x" } = process.env */
const JS_DESTRUCTURE = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:process\.env|import\.meta\.env|Bun\.env)\b/g;

/** Map a character offset to a 1-based line number. */
function lineIndex(src: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Blank out whole-line comments (keeping line breaks so line numbers stay
 * right). Deliberately line-based: a full tokenizer would trip over regex
 * literals, and whole-line comments cover doc blocks and commented-out code.
 */
function stripCommentLines(src: string, lang: Lang): string {
  const hashComments = lang === "py" || lang === "rb";
  return src
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      const isComment =
        (!hashComments && (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"))) ||
        (hashComments && t.startsWith("#"));
      return isComment ? "" : line;
    })
    .join("\n");
}

export function extract(file: string, rawSrc: string): Extraction {
  const lang = langFor(file);
  const out: Extraction = { usages: [], dynamic: [] };
  if (!lang) return out;
  const src = stripCommentLines(rawSrc, lang);
  const lineOf = lineIndex(src);

  for (const re of STATIC_PATTERNS[lang]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      out.usages.push({ name: m[1]!, file, line: lineOf(m.index!) });
    }
  }

  if (lang === "js") {
    for (const m of src.matchAll(JS_BRACKET)) {
      const inner = m[2]!;
      const key = STATIC_KEY.exec(inner);
      if (key) {
        out.usages.push({ name: key[1]!, file, line: lineOf(m.index!) });
      } else {
        out.dynamic.push({ file, line: lineOf(m.index!), snippet: m[0] });
      }
    }
    for (const m of src.matchAll(JS_DESTRUCTURE)) {
      const line = lineOf(m.index!);
      for (const part of m[1]!.split(",")) {
        const p = part.trim();
        if (!p || p.startsWith("...")) continue;
        const name = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(p)?.[1];
        if (name) out.usages.push({ name, file, line });
      }
    }
  }

  return out;
}
