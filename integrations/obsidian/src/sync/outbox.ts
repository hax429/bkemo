export type OutboxCapture =
  | { kind: 'typed'; id: string; content: string; idempotencyKey: string; createdAt: string; attempts: number; lastError?: string }
  | { kind: 'voice'; id: string; idempotencyKey: string; createdAt: string; attempts: number; audioKey: string; lastError?: string };

export function enqueueCapture(queue: OutboxCapture[], item: OutboxCapture): OutboxCapture[] {
  return [...queue, item];
}

export function markCaptureFailure(queue: OutboxCapture[], id: string, error: string): OutboxCapture[] {
  return queue.map((item) => item.id === id
    ? { ...item, attempts: item.attempts + 1, lastError: error }
    : item);
}

export function removeCapture(queue: OutboxCapture[], id: string): OutboxCapture[] {
  return queue.filter((item) => item.id !== id);
}
