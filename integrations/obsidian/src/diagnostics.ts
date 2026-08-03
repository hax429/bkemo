/** Redacted diagnostics — never log credentials, note bodies, or recordings. */
export function logDiagnostic(event: string, details: Record<string, string | number | boolean | null | undefined> = {}) {
  const safe: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|password|content|body|audio|credential/i.test(key)) continue;
    safe[key] = value;
  }
  console.debug(`[bkemo] ${event}`, safe);
}
