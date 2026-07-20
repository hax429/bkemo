type LifecycleHandler = () => Promise<void>;

let startHandler: LifecycleHandler = async () => undefined;
let pauseHandler: LifecycleHandler = async () => undefined;

/** Registered by the server entrypoint to keep migration code dependency-free. */
export function registerBackgroundJobLifecycle(handlers: { start: LifecycleHandler; pause: LifecycleHandler }) {
  startHandler = handlers.start;
  pauseHandler = handlers.pause;
}

export async function startBackgroundJobs() {
  await startHandler();
}

export async function pauseBackgroundJobs() {
  await pauseHandler();
}
