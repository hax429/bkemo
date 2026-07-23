export function createConnectivityRecovery(options: {
  isOnline: () => boolean;
  probe: () => Promise<boolean>;
  onOnline: () => void;
  intervalMs?: number;
}): () => void {
  const { isOnline, probe, onOnline, intervalMs = 10_000 } = options;
  let probing = false;

  const timer = setInterval(async () => {
    if (isOnline() || probing) return;
    probing = true;
    try {
      if (await probe()) onOnline();
    } finally {
      probing = false;
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
