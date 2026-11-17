/** Known secret formats. Matching any of these in an example file is a leak. */
const KNOWN: Array<[string, RegExp]> = [
  ["Anthropic API key", /^sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/],
  ["GitHub token", /^(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["AWS access key ID", /^(?:AKIA|ASIA)[0-9A-Z]{16}$/],
  ["Slack token", /^xox[abposr]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /^AIza[0-9A-Za-z_-]{35}$/],
  ["Stripe live key", /^(?:sk|rk)_live_[0-9A-Za-z]{16,}/],
  ["Razorpay live key", /^rzp_live_[A-Za-z0-9]{10,}/],
  ["JWT", /^eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

const SECRETY_KEY = /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|AUTH)/i;

const PLACEHOLDER =
  /(your|xxx|changeme|change_me|example|placeholder|replace|dummy|sample|todo|fixme|<|>|\$\{|\.\.\.|\*\*\*)/i;

function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Returns a human label if `value` looks like a real secret, else null.
 * Tuned to avoid flagging obvious placeholders like "your-key-here".
 */
export function detectSecret(key: string, value: string): string | null {
  const v = value.trim();
  if (v.length < 12 || PLACEHOLDER.test(v)) return null;

  for (const [label, re] of KNOWN) if (re.test(v)) return label;

  // Credentials inside a connection string: scheme://user:pass@host
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:([^@\s/]+)@/i.exec(v);
  if (url && url[1]!.length >= 12 && entropy(url[1]!) >= 3.5) {
    return "password in connection string";
  }

  // Generic high-entropy value under a secret-sounding key name.
  if (SECRETY_KEY.test(key) && v.length >= 20 && !/\s/.test(v) && entropy(v) >= 4) {
    return "high-entropy secret";
  }
  return null;
}
