import express from 'express';
import { FileService } from '../../lib/files';
import { getTokenFromRequest } from '../../lib/helper';
import { Readable, PassThrough } from 'stream';
import busboy from 'busboy';
import cors from 'cors';
import { fileTypeFromBuffer } from 'file-type';
import {
  GUEST_AVATAR_DIR,
  GUEST_AVATAR_MAX_BYTES,
  isAllowedGuestAvatarMime,
} from '../../lib/guestAvatarPaths';

const router = express.Router();
const AUTH_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

router.options('/', cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*',
  maxAge: 86400,
}));

/**
 * @swagger
 * /api/file/upload:
 *   post:
 *     tags:
 *       - File
 *     summary: Upload File
 *     operationId: uploadFile
 *     security:
 *       - bearer: []
 */
router.post('/', async (req, res) => {
  try {
    req.setTimeout(0);
    res.setTimeout(0);

    const token = await getTokenFromRequest(req);
    const isGuestAvatar = req.headers['x-guest-avatar'] === 'true' || req.query.isGuestAvatar === 'true';
    const guestMode = !token && !!isGuestAvatar;

    if (!token && !isGuestAvatar) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: "Content type must be multipart/form-data" });
    }

    const maxBytes = guestMode ? GUEST_AVATAR_MAX_BYTES : AUTH_UPLOAD_MAX_BYTES;
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: maxBytes, files: 1 },
    });

    let authFile: {
      stream: PassThrough;
      filename: string;
      mimeType: string;
      size: number;
      isUserVoiceRecording?: boolean;
      audioDuration?: string;
      audioDurationSeconds?: number;
    } | null = null;

    let guestChunks: Buffer[] | null = null;
    let fileTooLarge = false;

    let isUserVoiceRecording = false;
    let audioDuration: string | null = null;
    let audioDurationSeconds: number | null = null;

    bb.on('field', (fieldname, value) => {
      if (fieldname === 'isUserVoiceRecording' && value === 'true') {
        isUserVoiceRecording = true;
      } else if (fieldname === 'audioDuration') {
        audioDuration = value;
      } else if (fieldname === 'audioDurationSeconds') {
        audioDurationSeconds = parseInt(value, 10);
      }
    });

    bb.on('file', (fieldname, stream, info) => {
      if (fieldname !== 'file') {
        stream.resume();
        return;
      }

      if (guestMode) {
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            fileTooLarge = true;
            stream.destroy();
            return;
          }
          chunks.push(chunk);
        });
        stream.on('limit', () => { fileTooLarge = true; });
        stream.on('end', () => {
          guestChunks = chunks;
        });
        return;
      }

      let decodedFilename: string;
      try {
        decodedFilename = Buffer.from(info.filename, 'binary').toString('utf-8');
      } catch {
        decodedFilename = info.filename;
      }
      if (!decodedFilename || decodedFilename.trim() === '') {
        decodedFilename = info.filename || `upload_${Date.now()}`;
      }
      decodedFilename = decodedFilename.replace(/\s+/g, '_');

      const passThrough = new PassThrough();
      let fileSize = 0;
      stream.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > maxBytes) {
          fileTooLarge = true;
          stream.destroy();
          passThrough.destroy();
          return;
        }
        passThrough.write(chunk);
      });
      stream.on('limit', () => { fileTooLarge = true; });
      stream.on('end', () => {
        passThrough.end();
        authFile = {
          stream: passThrough,
          filename: decodedFilename,
          mimeType: info.mimeType,
          size: fileSize,
          isUserVoiceRecording,
          audioDuration: audioDuration || undefined,
          audioDurationSeconds: audioDurationSeconds || undefined,
        };
      });
    });

    bb.on('finish', async () => {
      if (fileTooLarge) {
        return res.status(413).json({ error: "File too large" });
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': req.headers.origin || '',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': 'true',
      };

      if (guestMode) {
        if (!guestChunks) {
          return res.status(400).json({ error: "No files received." });
        }
        const buffer = Buffer.concat(guestChunks);
        let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>> | undefined;
        try {
          detected = await fileTypeFromBuffer(buffer);
        } catch {
          detected = undefined;
        }
        const mime = detected?.mime || '';
        if (!isAllowedGuestAvatarMime(mime)) {
          return res.status(400).json({ error: "Only image files are allowed for guest avatars." });
        }
        const ext = detected?.ext ? `.${detected.ext}` : '.img';
        try {
          const filePath = await FileService.uploadFileStream({
            stream: Readable.toWeb(Readable.from(buffer)) as unknown as ReadableStream,
            originalName: `avatar${ext}`,
            fileSize: buffer.length,
            type: mime,
            accountId: null,
            pathPrefix: GUEST_AVATAR_DIR,
            metadata: { isGuestAvatar: true },
          });
          res.set(corsHeaders);
          return res.status(200).json({
            Message: "Success",
            status: 200,
            ...filePath,
            type: mime,
            size: buffer.length,
          });
        } catch (error) {
          console.error('Upload error:', error);
          return res.status(500).json({ error: "Upload failed" });
        }
      }

      if (!authFile) {
        return res.status(400).json({ error: "No files received." });
      }

      try {
        const metadata: Record<string, unknown> = {};
        if (authFile.isUserVoiceRecording) metadata.isUserVoiceRecording = true;
        if (authFile.audioDuration) metadata.audioDuration = authFile.audioDuration;
        if (authFile.audioDurationSeconds) metadata.audioDurationSeconds = authFile.audioDurationSeconds;

        const filePath = await FileService.uploadFileStream({
          stream: Readable.toWeb(authFile.stream) as unknown as ReadableStream,
          originalName: authFile.filename,
          fileSize: authFile.size,
          type: authFile.mimeType,
          accountId: token ? Number(token.id) : null,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });

        res.set(corsHeaders);
        return res.status(200).json({
          Message: "Success",
          status: 200,
          ...filePath,
          type: authFile.mimeType,
          size: authFile.size,
        });
      } catch (error) {
        console.error('Upload error:', error);
        return res.status(500).json({ error: "Upload failed" });
      }
    });

    req.pipe(bb);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
