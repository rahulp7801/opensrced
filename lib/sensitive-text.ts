const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /(?:github_pat_[A-Za-z0-9_]{60,}|gh[pousr]_[A-Za-z0-9]{36,})/],
  ["Anthropic key", /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}/],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["AWS access key", /(?:AKIA|ASIA)[0-9A-Z]{16}/],
  ["Slack token", /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ["npm token", /npm_[A-Za-z0-9]{36}/],
  ["PyPI token", /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{40,}/],
  ["Stripe live key", /(?:sk|rk)_live_[0-9A-Za-z]{20,}/],
];

/** Return only the credential kind; never return or log the matching value. */
export function sensitiveTextKind(values: Array<string | null | undefined>): string | null {
  const text = values.filter((value): value is string => Boolean(value)).join("\n");
  for (const [kind, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}
