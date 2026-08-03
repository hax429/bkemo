import express, { type Request, type Response } from 'express';
import busboy from 'busboy';
import { integrationGateway, IntegrationError } from '../lib/integrationGateway';
import { redactIntegrationError, sanitizeAttachmentDisplayName } from '../lib/obsidianContracts';
import {
  exchangeObsidianPairingCode,
  resolveObsidianActor,
  validateObsidianAccessToken,
} from '../lib/obsidianPairing';
import { FileService } from '../lib/files';
import { prisma } from '../prisma';
import { hardenFileContentType } from '../lib/safeFileResponse';

const router = express.Router();
const jsonBody = express.json({ limit: '1mb' });

function sendError(res: Response, error: unknown) {
  if (error instanceof IntegrationError) {
    const redacted = error.toRedacted();
    const status =
      redacted.code === 'unauthorized' ? 401
        : redacted.code === 'forbidden' ? 403
          : redacted.code === 'not_found' ? 404
            : redacted.code === 'revision_conflict' ? 409
              : redacted.code === 'oversized_media' || redacted.code === 'invalid_media' || redacted.code === 'invalid_duration' ? 413
                : redacted.code.startsWith('pairing_')
                  || redacted.code.startsWith('access_token_')
                  || redacted.code === 'invalid_pairing_code'
                  || redacted.code === 'invalid_access_token'
                  || redacted.code === 'invalid_idempotency_key'
                  || redacted.code === 'invalid_request' ? 400
                  : 500;
    return res.status(status).json(redacted);
  }
  return res.status(500).json(redactIntegrationError('internal'));
}

async function requireActor(req: Request, res: Response) {
  const actor = await resolveObsidianActor(req);
  if (!actor) {
    res.status(401).json(redactIntegrationError('unauthorized'));
    return null;
  }
  return actor;
}

router.post('/pair/exchange', jsonBody, async (req, res) => {
  try {
    const code = String(req.body?.code || '');
    const deviceLabel = typeof req.body?.deviceLabel === 'string' ? req.body.deviceLabel : undefined;
    const result = await exchangeObsidianPairingCode({ code, deviceLabel });
    return res.json({
      token: result.token,
      credentialId: result.credentialId,
      deviceLabel: result.deviceLabel,
      scopes: result.scopes,
      expiresAt: result.expiresAt,
      preview: result.preview,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

/** Validate a scoped access token for Obsidian use. The plugin stores the same token in SecretStorage. */
router.post('/pair/access-token', jsonBody, async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || '');
    return res.json(await validateObsidianAccessToken(accessToken));
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/session', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    return res.json({
      accountName: actor.accountName,
      scopes: actor.scopes,
      credentialKind: actor.credentialId.startsWith('access:') ? 'access-token' : 'device',
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/notes', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const archivedRaw = typeof req.query.archived === 'string' ? req.query.archived : undefined;
    const archived = archivedRaw === 'only' || archivedRaw === 'include' || archivedRaw === 'exclude'
      ? archivedRaw
      : undefined;
    const page = await integrationGateway.searchNotes(actor, {
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
      tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
      tasksOnly: req.query.tasks === '1' || req.query.tasks === 'true',
      archived,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    });
    return res.json(page);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/notes/:portableId', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    return res.json(await integrationGateway.getNote(actor, req.params.portableId));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/notes', jsonBody, async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const note = await integrationGateway.createNote(actor, {
      content: String(req.body?.content || ''),
      task: !!req.body?.task,
      dueDate: req.body?.dueDate ?? undefined,
      important: req.body?.important,
      urgent: req.body?.urgent,
      attachmentPortableIds: Array.isArray(req.body?.attachmentPortableIds) ? req.body.attachmentPortableIds : undefined,
      idempotencyKey: String(req.body?.idempotencyKey || ''),
    });
    return res.status(201).json(note);
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch('/notes/:portableId', jsonBody, async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const note = await integrationGateway.updateNote(actor, {
      portableId: req.params.portableId,
      expectedRevision: Number(req.body?.expectedRevision),
      content: req.body?.content,
      dueDate: req.body?.dueDate,
      important: req.body?.important,
      urgent: req.body?.urgent,
      idempotencyKey: String(req.body?.idempotencyKey || ''),
    });
    return res.json(note);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/changes', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const cursor = req.query.cursor ? Number(req.query.cursor) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    return res.json(await integrationGateway.listRecentChanges(actor, cursor, limit));
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/tags', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    return res.json(await integrationGateway.listTags(actor));
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/attachments/:portableId', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    return res.json(await integrationGateway.getAttachment(actor, req.params.portableId));
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/attachments/:portableId/content', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const meta = await integrationGateway.getAttachment(actor, req.params.portableId);
    const attachment = await prisma.attachments.findFirst({
      where: { portableId: meta.portableId, accountId: actor.accountId },
    });
    if (!attachment) throw new IntegrationError('not_found', 'Attachment not found');
    const buffer = await FileService.getFileBuffer(attachment.path);
    const fileName = sanitizeAttachmentDisplayName(attachment.name);
    const hardened = hardenFileContentType(attachment.type || 'application/octet-stream', fileName);
    res.setHeader('Content-Type', hardened.contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `${hardened.forceAttachment ? 'attachment' : 'inline'}; filename="${fileName.replace(/"/g, '')}"`,
    );
    return res.send(buffer);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/audio', async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new IntegrationError('invalid_request', 'Request is invalid');
    }

    const bb = busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
    let fileBuffer: Buffer | null = null;
    let fileName = 'recording.webm';
    let mimeType = 'audio/webm';
    let durationSeconds: number | null = null;
    let idempotencyKey = '';
    let truncated = false;

    const done = new Promise<void>((resolve, reject) => {
      bb.on('field', (name, value) => {
        if (name === 'idempotencyKey') idempotencyKey = value;
        if (name === 'durationSeconds') durationSeconds = Number(value);
        if (name === 'fileName') fileName = value;
      });
      bb.on('file', (_name, stream, info) => {
        fileName = info.filename || fileName;
        mimeType = info.mimeType || mimeType;
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('limit', () => { truncated = true; });
        stream.on('error', reject);
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });
      bb.on('error', reject);
      bb.on('finish', () => resolve());
    });

    req.pipe(bb);
    await done;

    if (truncated) throw new IntegrationError('oversized_media', 'Audio exceeds the size limit');
    if (!fileBuffer) throw new IntegrationError('invalid_media', 'Audio type is not supported');
    if (!idempotencyKey) throw new IntegrationError('invalid_idempotency_key', 'Idempotency key must be 8-128 safe characters');

    const attachment = await integrationGateway.uploadAudio(actor, {
      buffer: fileBuffer,
      fileName,
      mimeType,
      durationSeconds,
      idempotencyKey,
    });
    return res.status(201).json(attachment);
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
