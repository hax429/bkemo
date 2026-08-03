import { Router, type Request, type Response } from 'express';
import { createContext, type User } from '../context';
import { noteSyncHub, type NoteSyncHub } from '../lib/noteSync';
import { tokenAllowsPath } from '../../shared/lib/tokenPathMatch';

export const NOTE_EVENTS_PATH = '/api/v1/note/events';
export const NOTE_EVENTS_KEEPALIVE_MS = 15_000;

type ContextFactory = (req: Request, res: Response) => Promise<User>;

export function createNoteSyncRouter(
  hub: NoteSyncHub = noteSyncHub,
  contextFactory: ContextFactory = createContext,
) {
  const router = Router();

  router.get(NOTE_EVENTS_PATH, async (req, res) => {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Bearer authentication required' });
    }

    const ctx = await contextFactory(req, res);
    const accountId = Number(ctx?.sub ?? ctx?.id);
    if (!ctx?.name || !Number.isInteger(accountId) || accountId <= 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Match authProcedure's scoped-token behavior. notes:read expands to the
    // concrete "notes.changes" permission.
    if (Array.isArray(ctx.permissions) && !tokenAllowsPath(ctx.permissions, 'notes.changes')) {
      return res.status(403).json({ error: 'Token cannot read note changes' });
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('event: ready\ndata: {}\n\n');

    const unsubscribe = hub.subscribe(accountId, (event) => {
      if (!res.writableEnded) res.write(`event: dirty\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, NOTE_EVENTS_KEEPALIVE_MS);

    const close = () => {
      clearInterval(keepalive);
      unsubscribe();
    };
    req.once('close', close);
    res.once('close', close);
    return undefined;
  });

  return router;
}

export const noteSyncRouter = createNoteSyncRouter();
