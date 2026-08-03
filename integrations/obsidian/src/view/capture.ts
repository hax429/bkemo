export function newCaptureIdempotencyKey(kind: 'typed' | 'voice' = 'typed'): string {
  return `obsidian-${kind}-${crypto.randomUUID()}`;
}
