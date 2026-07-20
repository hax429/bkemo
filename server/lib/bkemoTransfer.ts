import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
} from 'crypto';
import { promisify } from 'util';
import Package from '../../package.json';
import { prisma } from '../prisma';
import { FileService, sanitizeUploadFileName } from './files';
import { ROOT_PATH, TEMP_PATH } from '@shared/lib/pathConstant';
import type { Context } from '../context';

const scrypt = promisify(scryptCallback);
const BK_MAGIC = Buffer.from('BKEMOBK1');
const RECOVERY_MAGIC = Buffer.from('BKEMOKEY1');
const FORMAT_VERSION = 1;
const SITE_KEY_PATH = path.join(ROOT_PATH, 'backup-site.key');
const SITE_ID_PATH = path.join(ROOT_PATH, 'site.id');
const RECOVERY_KEY_DIR = path.join(ROOT_PATH, 'recovery-keys');
export type TransferFormat = 'markdown' | 'json' | 'bk';
export type TransferMode = 'merge' | 'replace';

export type TransferResult = {
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  warnings: string[];
};

type PortableData = {
  format: 'bkemo-portable';
  version: number;
  exportedAt: string;
  appVersion: string;
  siteId: string;
  scope: 'account' | 'site';
  accounts: any[];
  notes: any[];
  tags: any[];
  tagsToNote: { notePortableId: string; tagPortableId: string }[];
  references: { fromPortableId: string; toPortableId: string; createdAt: string }[];
  attachments: any[];
  comments: any[];
  reactions: any[];
  histories: any[];
  internalShares: any[];
  configs: any[];
  accessTokens: any[];
  follows: any[];
  notifications: any[];
  conversations: any[];
  messages: any[];
  aiScheduledTasks: any[];
  site?: {
    plugins: any[];
    aiProviders: any[];
    aiModels: any[];
    mcpServers: any[];
    fonts: any[];
  };
};

type JsonExport = {
  format: 'bkemo-json';
  version: number;
  exportedAt: string;
  notes: any[];
  tags: any[];
  references: { fromPortableId: string; toPortableId: string }[];
  attachments: any[];
};

function b64(buffer: Buffer): string {
  return buffer.toString('base64');
}

function fromB64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2));
}

function transferStamp(): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '');
  return `${timestamp}-${randomBytes(4).toString('hex')}`;
}

async function ensurePrivateValue(filePath: string, make: () => Buffer): Promise<Buffer> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    return await readFile(filePath);
  } catch {
    const value = make();
    await writeFile(filePath, value, { mode: 0o600 });
    return value;
  }
}

export async function getBkemoSiteId(): Promise<string> {
  const raw = await ensurePrivateValue(SITE_ID_PATH, () => Buffer.from(randomBytes(6).toString('hex')));
  return raw.toString('utf8').trim();
}

async function getSiteKey(): Promise<Buffer> {
  const key = await ensurePrivateValue(SITE_KEY_PATH, () => randomBytes(32));
  if (key.length !== 32) throw new Error('The bkemo site backup key is invalid');
  return key;
}

type EncryptedChunk = { iv: Buffer; tag: Buffer; ciphertext: Buffer };

function encryptAes(plain: Buffer, key: Buffer, aad: Buffer): EncryptedChunk {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function decryptAes(chunk: EncryptedChunk, key: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, chunk.iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(chunk.tag);
  return Buffer.concat([decipher.update(chunk.ciphertext), decipher.final()]);
}

async function passphraseKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (passphrase.length < 8) throw new Error('Passphrase must contain at least 8 characters');
  return Buffer.from(await scrypt(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) as Buffer);
}

export async function encryptBkPayloadWithSiteKey(plain: Buffer, passphrase: string, siteId: string, siteKey: Buffer): Promise<Buffer> {
  const createdAt = new Date().toISOString();
  const aad = Buffer.from(`bkemo:${FORMAT_VERSION}:${siteId}:${createdAt}`);
  const inner = encryptAes(plain, siteKey, aad);
  const salt = randomBytes(16);
  const outer = encryptAes(inner.ciphertext, await passphraseKey(passphrase, salt), aad);
  const header = jsonBuffer({
    format: 'bkemo-bk',
    version: FORMAT_VERSION,
    appVersion: Package.version,
    createdAt,
    siteId,
    kdf: { name: 'scrypt', salt: b64(salt), N: 32768, r: 8, p: 1 },
    outer: { algorithm: 'aes-256-gcm', iv: b64(outer.iv), tag: b64(outer.tag) },
    inner: { algorithm: 'aes-256-gcm', iv: b64(inner.iv), tag: b64(inner.tag) },
  });
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([BK_MAGIC, length, header, outer.ciphertext]);
}

export async function encryptBkPayload(plain: Buffer, passphrase: string): Promise<Buffer> {
  return encryptBkPayloadWithSiteKey(plain, passphrase, await getBkemoSiteId(), await getSiteKey());
}

function readContainer(buffer: Buffer, magic: Buffer): { header: any; ciphertext: Buffer } {
  if (buffer.length < magic.length + 4 || !buffer.subarray(0, magic.length).equals(magic)) {
    throw new Error('Unsupported or corrupt bkemo encrypted file');
  }
  const headerLength = buffer.readUInt32BE(magic.length);
  const headerStart = magic.length + 4;
  const headerEnd = headerStart + headerLength;
  if (headerLength <= 0 || headerEnd > buffer.length) throw new Error('Corrupt bkemo encrypted header');
  return { header: JSON.parse(buffer.subarray(headerStart, headerEnd).toString('utf8')), ciphertext: buffer.subarray(headerEnd) };
}

export async function decryptBkPayloadWithSiteKey(buffer: Buffer, passphrase: string, siteKey: Buffer): Promise<{ header: any; plain: Buffer }> {
  const { header, ciphertext } = readContainer(buffer, BK_MAGIC);
  if (header.format !== 'bkemo-bk' || header.version !== FORMAT_VERSION) throw new Error('Unsupported .bk format version');
  const aad = Buffer.from(`bkemo:${header.version}:${header.siteId}:${header.createdAt}`);
  const innerCiphertext = decryptAes({
    iv: fromB64(header.outer.iv),
    tag: fromB64(header.outer.tag),
    ciphertext,
  }, await passphraseKey(passphrase, fromB64(header.kdf.salt)), aad);
  let plain: Buffer;
  try {
    plain = decryptAes({
      iv: fromB64(header.inner.iv),
      tag: fromB64(header.inner.tag),
      ciphertext: innerCiphertext,
    }, siteKey, aad);
  } catch {
    throw new Error(`This backup belongs to site ${header.siteId}. Import its administrator recovery key first.`);
  }
  return { header, plain };
}

export async function decryptBkPayload(buffer: Buffer, passphrase: string): Promise<{ header: any; plain: Buffer }> {
  const { header } = readContainer(buffer, BK_MAGIC);
  if (typeof header.siteId !== 'string' || !/^[a-z0-9_-]{6,64}$/i.test(header.siteId)) {
    throw new Error('The backup contains an invalid site identifier');
  }

  const candidateKeys: Buffer[] = [];
  if (header.siteId === await getBkemoSiteId()) candidateKeys.push(await getSiteKey());
  try {
    const recoveryKey = await readFile(path.join(RECOVERY_KEY_DIR, `${header.siteId}.key`));
    if (recoveryKey.length === 32 && !candidateKeys.some((key) => key.equals(recoveryKey))) candidateKeys.push(recoveryKey);
  } catch {
    // A recovery key is optional for backups created by another deployment.
  }

  for (const siteKey of candidateKeys) {
    try {
      return await decryptBkPayloadWithSiteKey(buffer, passphrase, siteKey);
    } catch (error: any) {
      if (!String(error?.message ?? '').includes('belongs to site')) throw error;
    }
  }
  throw new Error(`This backup belongs to site ${header.siteId}. Import its administrator recovery key first.`);
}

export async function createRecoveryKeyFile(passphrase: string): Promise<Buffer> {
  const siteId = await getBkemoSiteId();
  const salt = randomBytes(16);
  const createdAt = new Date().toISOString();
  const aad = Buffer.from(`bkemo-recovery:${siteId}:${createdAt}`);
  const encrypted = encryptAes(await getSiteKey(), await passphraseKey(passphrase, salt), aad);
  const header = jsonBuffer({
    format: 'bkemo-recovery-key',
    version: FORMAT_VERSION,
    siteId,
    createdAt,
    kdf: { name: 'scrypt', salt: b64(salt), N: 32768, r: 8, p: 1 },
    encryption: { algorithm: 'aes-256-gcm', iv: b64(encrypted.iv), tag: b64(encrypted.tag) },
  });
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([RECOVERY_MAGIC, length, header, encrypted.ciphertext]);
}

export async function installRecoveryKeyFile(buffer: Buffer, passphrase: string): Promise<string> {
  const { header, ciphertext } = readContainer(buffer, RECOVERY_MAGIC);
  if (header.format !== 'bkemo-recovery-key' || header.version !== FORMAT_VERSION) throw new Error('Unsupported recovery key');
  const aad = Buffer.from(`bkemo-recovery:${header.siteId}:${header.createdAt}`);
  const key = decryptAes({
    iv: fromB64(header.encryption.iv),
    tag: fromB64(header.encryption.tag),
    ciphertext,
  }, await passphraseKey(passphrase, fromB64(header.kdf.salt)), aad);
  if (key.length !== 32) throw new Error('Invalid recovery key payload');
  if (typeof header.siteId !== 'string' || !/^[a-z0-9_-]{6,64}$/i.test(header.siteId)) {
    throw new Error('The recovery key contains an invalid site identifier');
  }
  await mkdir(RECOVERY_KEY_DIR, { recursive: true, mode: 0o700 });
  await writeFile(path.join(RECOVERY_KEY_DIR, `${header.siteId}.key`), key, { mode: 0o600 });
  return header.siteId;
}

async function writeTempDownload(filename: string, contents: Buffer): Promise<{ path: string; downloadUrl: string; filename: string }> {
  await mkdir(TEMP_PATH, { recursive: true });
  const filePath = path.join(TEMP_PATH, filename);
  await writeFile(filePath, contents, { mode: 0o600 });
  return { path: filePath, downloadUrl: `/api/file/temp/${filename}`, filename };
}

export function scheduleTransferCleanup(filePath: string): void {
  setTimeout(() => fs.promises.unlink(filePath).catch(() => undefined), 10 * 60 * 1000);
}

function omit<T extends Record<string, any>>(row: T, keys: string[]): Record<string, any> {
  const result = { ...row };
  for (const key of keys) delete result[key];
  return result;
}

function accountPortableId(accountMap: Map<number, string>, id?: number | null): string | null {
  return id == null ? null : accountMap.get(id) ?? null;
}

export async function isFirstSuperadminAccount(accountId: number): Promise<boolean> {
  const firstAccount = await prisma.accounts.findFirst({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, role: true },
  });
  return firstAccount?.id === accountId && firstAccount.role === 'superadmin';
}

async function gatherPortableData(ctx: Context, includeSite: boolean): Promise<PortableData> {
  const callerId = Number(ctx.id);
  const caller = await prisma.accounts.findUnique({ where: { id: callerId } });
  if (!caller) throw new Error('Account not found');
  if (includeSite && !(await isFirstSuperadminAccount(callerId))) {
    throw new Error('Only the first superadmin account can export the full site');
  }

  const accountRows = includeSite
    ? await prisma.accounts.findMany({ orderBy: { id: 'asc' } })
    : [caller];
  const accountIds = accountRows.map((account) => account.id);
  const accountMap = new Map(accountRows.map((account) => [account.id, account.portableId]));

  const notes = await prisma.notes.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } });
  const noteIds = notes.map((note) => note.id);
  const noteMap = new Map(notes.map((note) => [note.id, note.portableId]));
  const tags = await prisma.tag.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } });
  const tagIds = tags.map((tag) => tag.id);
  const tagMap = new Map(tags.map((tag) => [tag.id, tag.portableId]));
  const parentTagMap = new Map(tags.map((tag) => [tag.id, tag.parent]));

  const [
    tagsToNote,
    references,
    attachments,
    comments,
    reactions,
    histories,
    internalShares,
    configs,
    accessTokens,
    follows,
    notifications,
    conversations,
    aiScheduledTasks,
  ] = await Promise.all([
    prisma.tagsToNote.findMany({ where: { noteId: { in: noteIds }, tagId: { in: tagIds } } }),
    prisma.noteReference.findMany({ where: { fromNoteId: { in: noteIds }, toNoteId: { in: noteIds } } }),
    prisma.attachments.findMany({ where: includeSite ? {} : { OR: [{ accountId: callerId }, { note: { accountId: callerId } }] }, orderBy: { id: 'asc' } }),
    prisma.comments.findMany({ where: { noteId: { in: noteIds } }, orderBy: { id: 'asc' } }),
    prisma.reaction.findMany({ where: { noteId: { in: noteIds } }, orderBy: { id: 'asc' } }),
    prisma.noteHistory.findMany({ where: { noteId: { in: noteIds } }, orderBy: { id: 'asc' } }),
    prisma.noteInternalShare.findMany({ where: { noteId: { in: noteIds } }, orderBy: { id: 'asc' } }),
    prisma.config.findMany({ where: includeSite ? {} : { userId: callerId }, orderBy: { id: 'asc' } }),
    includeSite ? prisma.accessToken.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
    prisma.follows.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } }),
    prisma.notifications.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } }),
    prisma.conversation.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } }),
    prisma.aiScheduledTask.findMany({ where: { accountId: { in: accountIds } }, orderBy: { id: 'asc' } }),
  ]);
  const conversationMap = new Map(conversations.map((conversation) => [conversation.id, conversation.portableId]));
  const messages = await prisma.message.findMany({ where: { conversationId: { in: conversations.map((row) => row.id) } }, orderBy: { id: 'asc' } });
  const commentMap = new Map(comments.map((comment) => [comment.id, comment.portableId]));

  const portableAccounts = accountRows.map((account) => ({
    ...omit(account, includeSite ? ['id', 'linkAccountId'] : ['id', 'apiToken', 'linkAccountId']),
    linkAccountPortableId: accountPortableId(accountMap, account.linkAccountId),
  }));

  const portableNotes = notes.map((note) => ({
    ...omit(note, ['id', 'accountId', 'parentNoteId']),
    sourceId: note.id,
    accountPortableId: accountPortableId(accountMap, note.accountId),
    parentPortableId: note.parentNoteId ? noteMap.get(note.parentNoteId) ?? null : null,
  }));

  const portableTags = tags.map((tag) => ({
    ...omit(tag, ['id', 'accountId', 'parent']),
    accountPortableId: accountPortableId(accountMap, tag.accountId),
    parentPortableId: parentTagMap.get(tag.id) ? tagMap.get(parentTagMap.get(tag.id)!) ?? null : null,
  }));

  const data: PortableData = {
    format: 'bkemo-portable',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: Package.version,
    siteId: await getBkemoSiteId(),
    scope: includeSite ? 'site' : 'account',
    accounts: portableAccounts,
    notes: portableNotes,
    tags: portableTags,
    tagsToNote: tagsToNote.flatMap((row) => {
      const notePortableId = noteMap.get(row.noteId);
      const tagPortableId = tagMap.get(row.tagId);
      return notePortableId && tagPortableId ? [{ notePortableId, tagPortableId }] : [];
    }),
    references: references.flatMap((row) => {
      const fromPortableId = noteMap.get(row.fromNoteId);
      const toPortableId = noteMap.get(row.toNoteId);
      return fromPortableId && toPortableId ? [{ fromPortableId, toPortableId, createdAt: row.createdAt.toISOString() }] : [];
    }),
    attachments: attachments.map((row) => ({
      ...omit(row, ['id', 'accountId', 'noteId']),
      size: row.size.toString(),
      accountPortableId: accountPortableId(accountMap, row.accountId),
      notePortableId: row.noteId ? noteMap.get(row.noteId) ?? null : null,
      archivePath: `attachments/${row.portableId}/${sanitizeUploadFileName(row.name)}`,
    })),
    comments: comments.map((row) => ({
      ...omit(row, ['id', 'accountId', 'noteId', 'parentId', 'guestIP', 'guestUA']),
      accountPortableId: accountPortableId(accountMap, row.accountId),
      notePortableId: noteMap.get(row.noteId),
      parentPortableId: row.parentId ? commentMap.get(row.parentId) ?? null : null,
    })),
    reactions: reactions.map((row) => ({ ...omit(row, ['id', 'noteId']), notePortableId: noteMap.get(row.noteId) })),
    histories: histories.map((row) => ({
      ...omit(row, ['id', 'accountId', 'noteId']),
      accountPortableId: accountPortableId(accountMap, row.accountId),
      notePortableId: noteMap.get(row.noteId),
    })),
    internalShares: internalShares.flatMap((row) => {
      const notePortableId = noteMap.get(row.noteId);
      const targetAccountPortableId = accountMap.get(row.accountId);
      return notePortableId && targetAccountPortableId
        ? [{ ...omit(row, ['id', 'noteId', 'accountId']), notePortableId, targetAccountPortableId }]
        : [];
    }),
    configs: configs.map((row) => ({ ...omit(row, ['id', 'userId']), accountPortableId: accountPortableId(accountMap, row.userId) })),
    accessTokens: accessTokens.map((row) => ({ ...omit(row, ['id', 'accountId']), accountPortableId: accountMap.get(row.accountId) })),
    follows: follows.map((row) => ({ ...omit(row, ['id', 'accountId']), accountPortableId: accountMap.get(row.accountId) })),
    notifications: notifications.map((row) => ({ ...omit(row, ['id', 'accountId']), accountPortableId: accountMap.get(row.accountId) })),
    conversations: conversations.map((row) => ({ ...omit(row, ['id', 'accountId']), accountPortableId: accountMap.get(row.accountId) })),
    messages: messages.map((row) => ({ ...omit(row, ['id', 'conversationId']), conversationPortableId: conversationMap.get(row.conversationId) })),
    aiScheduledTasks: aiScheduledTasks.map((row) => ({ ...omit(row, ['id', 'accountId']), accountPortableId: accountMap.get(row.accountId) })),
  };

  if (includeSite) {
    const [plugins, aiProviders, aiModels, mcpServers, fonts] = await Promise.all([
      prisma.plugin.findMany({ orderBy: { id: 'asc' } }),
      prisma.aiProviders.findMany({ orderBy: { id: 'asc' } }),
      prisma.aiModels.findMany({ orderBy: { id: 'asc' } }),
      prisma.mcpServers.findMany({ orderBy: { id: 'asc' } }),
      prisma.fonts.findMany({ orderBy: { id: 'asc' } }),
    ]);
    const providerMap = new Map(aiProviders.map((row) => [row.id, `${row.provider}:${row.title}`]));
    data.site = {
      plugins: plugins.map((row) => omit(row, ['id'])),
      aiProviders: aiProviders.map((row) => ({ ...omit(row, ['id']), portableKey: providerMap.get(row.id) })),
      aiModels: aiModels.map((row) => ({ ...omit(row, ['id', 'providerId']), providerPortableKey: providerMap.get(row.providerId) })),
      mcpServers: mcpServers.map((row) => omit(row, ['id'])),
      fonts: fonts.map((row) => ({ ...omit(row, ['id', 'fileData']), fileDataBase64: row.fileData ? Buffer.from(row.fileData).toString('base64') : null })),
    };
  }
  return data;
}

async function addAttachmentFiles(zip: AdmZip, attachments: any[]): Promise<{ path: string; sha256: string; size: number }[]> {
  const manifest: { path: string; sha256: string; size: number }[] = [];
  for (const attachment of attachments) {
    try {
      const buffer = await FileService.getFileBuffer(attachment.path);
      zip.addFile(attachment.archivePath, buffer);
      manifest.push({ path: attachment.archivePath, sha256: sha256(buffer), size: buffer.length });
    } catch (error: any) {
      attachment.binaryMissing = true;
      attachment.binaryError = error?.message ?? 'Attachment could not be read';
    }
  }
  return manifest;
}

export async function exportBk(ctx: Context, passphrase: string): Promise<{ path: string; downloadUrl: string; filename: string; scope: 'account' | 'site' }> {
  const includeSite = await isFirstSuperadminAccount(Number(ctx.id));
  const data = await gatherPortableData(ctx, includeSite);
  const zip = new AdmZip();
  const attachmentManifest = await addAttachmentFiles(zip, data.attachments);
  const dataBytes = jsonBuffer(data);
  zip.addFile('data.json', dataBytes);
  zip.addFile('manifest.json', jsonBuffer({
    format: 'bkemo-bk-manifest',
    version: FORMAT_VERSION,
    data: { path: 'data.json', sha256: sha256(dataBytes), size: dataBytes.length },
    attachments: attachmentManifest,
  }));
  const encrypted = await encryptBkPayload(zip.toBuffer(), passphrase);
  const stamp = transferStamp();
  const result = await writeTempDownload(`bkemo-backup-${stamp}.bk`, encrypted);
  scheduleTransferCleanup(result.path);
  return { ...result, scope: data.scope };
}

type ExportSelection = {
  scope?: 'all' | 'active' | 'archived' | 'trash';
  startDate?: Date;
  endDate?: Date;
};

async function gatherJsonExport(ctx: Context, selection: ExportSelection): Promise<JsonExport> {
  const accountId = Number(ctx.id);
  const where: any = {
    accountId,
    createdAt: {
      ...(selection.startDate ? { gte: selection.startDate } : {}),
      ...(selection.endDate ? { lte: selection.endDate } : {}),
    },
  };
  if (selection.scope === 'active' || !selection.scope) Object.assign(where, { isRecycle: false, isArchived: false });
  if (selection.scope === 'archived') Object.assign(where, { isArchived: true, isRecycle: false });
  if (selection.scope === 'trash') Object.assign(where, { isRecycle: true });
  const notes = await prisma.notes.findMany({
    where,
    include: { tags: { include: { tag: true } }, attachments: true, references: true },
    orderBy: { createdAt: 'asc' },
  });
  const noteIds = notes.map((note) => note.id);
  const noteMap = new Map(notes.map((note) => [note.id, note.portableId]));
  const tags = new Map<string, any>();
  for (const note of notes) for (const relation of note.tags) tags.set(relation.tag.portableId, relation.tag);
  const exportedTags = [...tags.values()];
  const exportedTagMap = new Map(exportedTags.map((tag) => [tag.id, tag.portableId]));
  return {
    format: 'bkemo-json',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    notes: notes.map((note) => ({
      ...omit(note, [
        'id', 'accountId', 'parentNoteId', 'tags', 'attachments', 'references',
        'isShare', 'sharePassword', 'shareEncryptedUrl', 'shareExpiryDate', 'shareMaxView', 'shareViewCount',
      ]),
      sourceId: note.id,
      parentPortableId: note.parentNoteId ? noteMap.get(note.parentNoteId) ?? null : null,
      tagPortableIds: note.tags.map((relation) => relation.tag.portableId),
      attachmentPortableIds: note.attachments.map((attachment) => attachment.portableId),
    })),
    tags: exportedTags.map((tag) => ({ ...omit(tag, ['id', 'accountId', 'parent']), sourceId: tag.id, parentPortableId: tag.parent ? exportedTagMap.get(tag.parent) ?? null : null })),
    references: (await prisma.noteReference.findMany({ where: { fromNoteId: { in: noteIds }, toNoteId: { in: noteIds } } })).flatMap((row) => {
      const fromPortableId = noteMap.get(row.fromNoteId);
      const toPortableId = noteMap.get(row.toNoteId);
      return fromPortableId && toPortableId ? [{ fromPortableId, toPortableId }] : [];
    }),
    attachments: notes.flatMap((note) => note.attachments.map((attachment) => ({
      ...omit(attachment, ['id', 'accountId', 'noteId', 'path', 'isShare', 'sharePassword']),
      size: attachment.size.toString(),
      notePortableId: note.portableId,
      binaryIncluded: false,
    }))),
  };
}

function frontmatterValue(value: unknown): string {
  return JSON.stringify(value);
}

function markdownDocument(metadata: Record<string, unknown>, content: string): string {
  const lines = Object.entries(metadata).map(([key, value]) => `${key}: ${frontmatterValue(value)}`);
  return `---\n${lines.join('\n')}\n---\n${content}`;
}

export async function exportReadable(ctx: Context, format: 'markdown' | 'json', selection: ExportSelection): Promise<{ path: string; downloadUrl: string; filename: string; fileCount: number }> {
  const data = await gatherJsonExport(ctx, selection);
  const stamp = transferStamp();
  if (format === 'json') {
    const result = await writeTempDownload(`bkemo-data-${stamp}.json`, jsonBuffer(data));
    scheduleTransferCleanup(result.path);
    return { ...result, fileCount: data.notes.length };
  }

  const zip = new AdmZip();
  const checksums: { path: string; sha256: string; size: number }[] = [];
  const attachmentByPortableId = new Map(data.attachments.map((attachment) => [attachment.portableId, attachment]));
  const referencesByNote = new Map<string, string[]>();
  for (const reference of data.references) {
    referencesByNote.set(reference.fromPortableId, [...(referencesByNote.get(reference.fromPortableId) ?? []), reference.toPortableId]);
  }
  for (const note of data.notes) {
    let content = note.content ?? '';
    const exportedAttachments: any[] = [];
    for (const portableId of note.attachmentPortableIds ?? []) {
      const attachment = attachmentByPortableId.get(portableId);
      if (!attachment) continue;
      const archivePath = `attachments/${note.portableId}/${sanitizeUploadFileName(attachment.name)}`;
      try {
        const source = await prisma.attachments.findUnique({ where: { portableId } });
        if (!source) continue;
        const buffer = await FileService.getFileBuffer(source.path);
        zip.addFile(archivePath, buffer);
        checksums.push({ path: archivePath, sha256: sha256(buffer), size: buffer.length });
        exportedAttachments.push({ portableId, name: attachment.name, type: attachment.type, size: attachment.size, archivePath });
        if (content.includes(source.path)) content = content.split(source.path).join(`./${archivePath}`);
        else content += `\n\n${/^image\//.test(attachment.type ?? '') ? '!' : ''}[${attachment.name}](./${archivePath})`;
      } catch {
        exportedAttachments.push({ portableId, name: attachment.name, type: attachment.type, size: attachment.size, binaryMissing: true });
      }
    }
    const document = markdownDocument({
      bkemo: FORMAT_VERSION,
      portableId: note.portableId,
      sourceId: note.sourceId,
      type: note.type,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      dueDate: note.dueDate,
      completedAt: note.completedAt,
      isImportant: note.isImportant,
      isUrgent: note.isUrgent,
      isTop: note.isTop,
      isArchived: note.isArchived,
      isRecycle: note.isRecycle,
      parentPortableId: note.parentPortableId,
      tagPortableIds: note.tagPortableIds,
      referencePortableIds: referencesByNote.get(note.portableId) ?? [],
      attachments: exportedAttachments,
    }, content);
    const memoPath = `memos/${note.portableId}.md`;
    const bytes = Buffer.from(document);
    zip.addFile(memoPath, bytes);
    checksums.push({ path: memoPath, sha256: sha256(bytes), size: bytes.length });
  }
  const tagsBytes = jsonBuffer(data.tags);
  zip.addFile('tags.json', tagsBytes);
  checksums.push({ path: 'tags.json', sha256: sha256(tagsBytes), size: tagsBytes.length });
  zip.addFile('manifest.json', jsonBuffer({ format: 'bkemo-markdown', version: FORMAT_VERSION, exportedAt: data.exportedAt, files: checksums }));
  const result = await writeTempDownload(`bkemo-markdown-${stamp}.zip`, zip.toBuffer());
  scheduleTransferCleanup(result.path);
  return { ...result, fileCount: data.notes.length };
}

export async function exportRecoveryKey(accountId: number, passphrase: string): Promise<{ path: string; downloadUrl: string; filename: string }> {
  if (!(await isFirstSuperadminAccount(accountId))) throw new Error('Only the first superadmin can export the recovery key');
  const siteId = await getBkemoSiteId();
  const result = await writeTempDownload(`bkemo-site-${siteId}-${transferStamp()}.bk-key`, await createRecoveryKeyFile(passphrase));
  scheduleTransferCleanup(result.path);
  return result;
}

export function parseFrontmatter(raw: string): { metadata: Record<string, any>; content: string; plain: boolean } {
  if (!raw.startsWith('---\n')) return { metadata: {}, content: raw, plain: true };
  const end = raw.indexOf('\n---\n', 4);
  // A broken or non-bkemo frontmatter block is valid plain Markdown. Importing
  // user-authored Markdown must never fail just because metadata is absent.
  if (end < 0) return { metadata: {}, content: raw, plain: true };
  const metadata: Record<string, any> = {};
  try {
    for (const line of raw.slice(4, end).split('\n')) {
      const separator = line.indexOf(':');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      try { metadata[key] = JSON.parse(value); }
      catch { metadata[key] = value; }
    }
  } catch {
    return { metadata: {}, content: raw, plain: true };
  }
  if (metadata.bkemo !== FORMAT_VERSION) return { metadata: {}, content: raw, plain: true };
  return { metadata, content: raw.slice(end + 5), plain: false };
}

function validateZip(zip: AdmZip, manifest: any): void {
  const entries = zip.getEntries();
  if (entries.length > 20_000) throw new Error('Archive contains too many entries');
  const total = entries.reduce((sum, entry) => sum + (entry.header.size || 0), 0);
  if (total > 5 * 1024 * 1024 * 1024) throw new Error('Archive expands beyond the 5 GB safety limit');
  const declared = [manifest?.data, ...(manifest?.attachments ?? []), ...(manifest?.files ?? [])].filter(Boolean);
  for (const item of declared) {
    const entry = zip.getEntry(item.path);
    if (!entry || entry.isDirectory) throw new Error(`Archive entry is missing: ${item.path}`);
    const buffer = entry.getData();
    if (buffer.length !== item.size || sha256(buffer) !== item.sha256) throw new Error(`Archive checksum failed: ${item.path}`);
  }
}

type LoadedImport = {
  format: 'bk' | 'json' | 'markdown';
  data?: PortableData | JsonExport;
  markdown?: { metadata: Record<string, any>; content: string; archiveAttachments: Map<string, Buffer> }[];
  markdownTags?: any[];
  scope: 'account' | 'site';
};

async function loadImport(filePath: string, passphrase?: string): Promise<LoadedImport> {
  const buffer = await readFile(filePath);
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.bk')) {
    if (!passphrase) throw new Error('A passphrase is required for .bk files');
    const { plain } = await decryptBkPayload(buffer, passphrase);
    const zip = new AdmZip(plain);
    const manifestEntry = zip.getEntry('manifest.json');
    const dataEntry = zip.getEntry('data.json');
    if (!manifestEntry || !dataEntry) throw new Error('The .bk archive is missing its manifest or data');
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    validateZip(zip, manifest);
    const data = JSON.parse(dataEntry.getData().toString('utf8')) as PortableData;
    if (data.format !== 'bkemo-portable' || data.version !== FORMAT_VERSION) throw new Error('Unsupported .bk data version');
    for (const attachment of data.attachments) {
      const entry = zip.getEntry(attachment.archivePath);
      if (entry && !entry.isDirectory) attachment.__buffer = entry.getData();
    }
    return { format: 'bk', data, scope: data.scope };
  }

  if (lower.endsWith('.json')) {
    const data = JSON.parse(buffer.toString('utf8')) as JsonExport;
    if (data.format !== 'bkemo-json' || data.version !== FORMAT_VERSION || !Array.isArray(data.notes)) {
      throw new Error('This is not a supported bkemo JSON export');
    }
    return { format: 'json', data, scope: 'account' };
  }

  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const parsed = parseFrontmatter(buffer.toString('utf8'));
    return { format: 'markdown', scope: 'account', markdown: [{ ...parsed, archiveAttachments: new Map() }] };
  }

  if (lower.endsWith('.zip')) {
    const zip = new AdmZip(buffer);
    const manifestEntry = zip.getEntry('manifest.json');
    let manifest: any = {};
    if (manifestEntry) {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    }
    validateZip(zip, manifest.format === 'bkemo-markdown' ? manifest : {});
    const markdown = zip.getEntries()
      .filter((entry) => !entry.isDirectory && /\.(md|markdown)$/i.test(entry.entryName))
      .map((entry) => {
        const parsed = parseFrontmatter(entry.getData().toString('utf8'));
        const archiveAttachments = new Map<string, Buffer>();
        for (const attachment of parsed.metadata.attachments ?? []) {
          if (!attachment?.archivePath) continue;
          const attachmentEntry = zip.getEntry(attachment.archivePath);
          if (attachmentEntry && !attachmentEntry.isDirectory) archiveAttachments.set(attachment.archivePath, attachmentEntry.getData());
        }
        return { ...parsed, archiveAttachments };
      });
    if (markdown.length === 0) throw new Error('The ZIP does not contain any Markdown files');
    let markdownTags: any[] = [];
    const tagsEntry = zip.getEntry('tags.json');
    if (tagsEntry) {
      try { markdownTags = JSON.parse(tagsEntry.getData().toString('utf8')); } catch { markdownTags = []; }
    }
    return { format: 'markdown', scope: 'account', markdown, markdownTags };
  }
  throw new Error('Supported imports are .md, .zip, .json, and .bk');
}

export async function previewImport(filePath: string, passphrase: string | undefined, ctx: Context) {
  const loaded = await loadImport(filePath, passphrase);
  const isFirstSuperadmin = await isFirstSuperadminAccount(Number(ctx.id));
  if (loaded.scope === 'site' && !isFirstSuperadmin) throw new Error('Only the first superadmin can inspect or restore a full-site backup');
  const data: any = loaded.data;
  return {
    format: loaded.format,
    scope: loaded.scope,
    notes: loaded.markdown?.length ?? data?.notes?.length ?? 0,
    attachments: data?.attachments?.length ?? loaded.markdown?.reduce((count, note) => count + (note.metadata.attachments?.length ?? 0), 0) ?? 0,
    accounts: loaded.scope === 'site' ? data?.accounts?.length ?? 0 : 1,
    canRestoreSharing: isFirstSuperadmin && loaded.format === 'bk',
    canRestoreSiteSettings: isFirstSuperadmin && loaded.scope === 'site',
    plainMarkdown: loaded.markdown?.filter((entry) => entry.plain).length ?? 0,
  };
}

function noteFields(source: any, sharing: Record<string, any>): Record<string, any> {
  return {
    type: Number.isInteger(source.type) ? source.type : 0,
    content: typeof source.content === 'string' ? source.content : '',
    isArchived: !!source.isArchived,
    isRecycle: !!source.isRecycle,
    isTop: !!source.isTop,
    isReviewed: !!source.isReviewed,
    dueDate: source.dueDate ? new Date(source.dueDate) : null,
    isImportant: !!source.isImportant,
    isUrgent: !!source.isUrgent,
    completedAt: source.completedAt ? new Date(source.completedAt) : null,
    metadata: source.metadata ?? null,
    sortOrder: Number.isInteger(source.sortOrder) ? source.sortOrder : 0,
    createdAt: source.createdAt ? new Date(source.createdAt) : new Date(),
    updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date(),
    ...sharing,
  };
}

function sharingFields(source: any, allowed: boolean): Record<string, any> {
  if (!allowed || !source.isShare || !source.shareEncryptedUrl) {
    return { isShare: false, sharePassword: '', shareEncryptedUrl: null, shareExpiryDate: null, shareMaxView: 0, shareViewCount: 0 };
  }
  return {
    isShare: true,
    sharePassword: source.sharePassword ?? '',
    shareEncryptedUrl: source.shareEncryptedUrl,
    shareExpiryDate: source.shareExpiryDate ? new Date(source.shareExpiryDate) : null,
    shareMaxView: source.shareMaxView ?? 0,
    shareViewCount: source.shareViewCount ?? 0,
  };
}

async function clearAccountForReplace(db: any, accountId: number): Promise<void> {
  const noteIds = (await db.notes.findMany({ where: { accountId }, select: { id: true } })).map((row: any) => row.id);
  if (noteIds.length) {
    await db.reaction.deleteMany({ where: { noteId: { in: noteIds } } });
    await db.comments.deleteMany({ where: { noteId: { in: noteIds } } });
    await db.noteHistory.deleteMany({ where: { noteId: { in: noteIds } } });
    await db.noteInternalShare.deleteMany({ where: { noteId: { in: noteIds } } });
    await db.noteReference.deleteMany({ where: { OR: [{ fromNoteId: { in: noteIds } }, { toNoteId: { in: noteIds } }] } });
    await db.tagsToNote.deleteMany({ where: { noteId: { in: noteIds } } });
    await db.attachments.deleteMany({ where: { noteId: { in: noteIds } } });
    await db.notes.deleteMany({ where: { id: { in: noteIds } } });
  }
}

async function ensureShareSlugAvailable(db: any, source: any, existingId: number | null, result: TransferResult): Promise<Record<string, any>> {
  if (!source.isShare || !source.shareEncryptedUrl) return sharingFields(source, false);
  const collision = await db.notes.findFirst({ where: { shareEncryptedUrl: source.shareEncryptedUrl, ...(existingId ? { id: { not: existingId } } : {}) }, select: { id: true, portableId: true } });
  if (collision && collision.portableId !== source.portableId) {
    result.warnings.push(`Share URL /m/${source.shareEncryptedUrl} already belongs to another memo; the imported memo was made private.`);
    result.skipped++;
    return sharingFields(source, false);
  }
  return sharingFields(source, true);
}

function safePortableId(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

async function restoreReadable(loaded: LoadedImport, ctx: Context, mode: TransferMode): Promise<TransferResult> {
  const accountId = Number(ctx.id);
  const result: TransferResult = { created: 0, updated: 0, conflicts: 0, skipped: 0, warnings: [] };
  const json = loaded.format === 'json' ? loaded.data as JsonExport : null;
  const sources = json
    ? json.notes
    : (loaded.markdown ?? []).map((entry) => ({
        ...entry.metadata,
        portableId: safePortableId(entry.metadata.portableId),
        content: entry.content,
        __archiveAttachments: entry.archiveAttachments,
        __plain: entry.plain,
      }));
  const sourceTags = json?.tags ?? loaded.markdownTags ?? [];
  const noteIdMap = new Map<string, number>();
  const sourceIdMap = new Map<number, number>();
  const tagIdMap = new Map<string, number>();
  const pendingAttachments: { notePortableId: string; noteId: number; descriptor: any; buffer: Buffer }[] = [];

  await prisma.$transaction(async (db) => {
    if (mode === 'replace') await clearAccountForReplace(db, accountId);

    for (const source of sourceTags) {
      const portableId = safePortableId(source.portableId);
      const byPortable = await db.tag.findUnique({ where: { portableId } });
      const existing = byPortable?.accountId === accountId
        ? byPortable
        : await db.tag.findFirst({ where: { accountId, name: source.name ?? 'Imported' } });
      const tag = existing
        ? await db.tag.update({ where: { id: existing.id }, data: { name: source.name ?? existing.name, icon: source.icon ?? existing.icon, sortOrder: source.sortOrder ?? existing.sortOrder } })
        : await db.tag.create({ data: { portableId: byPortable ? randomUUID() : portableId, accountId, name: source.name ?? 'Imported', icon: source.icon ?? '', parent: 0, sortOrder: source.sortOrder ?? 0 } });
      tagIdMap.set(source.portableId ?? portableId, tag.id);
    }
    for (const source of sourceTags) {
      const tagId = tagIdMap.get(source.portableId);
      const parent = source.parentPortableId ? tagIdMap.get(source.parentPortableId) ?? 0 : 0;
      if (tagId) await db.tag.update({ where: { id: tagId }, data: { parent } });
    }

    for (const source of sources) {
      const incomingPortableId = safePortableId(source.portableId);
      const globalMatch = await db.notes.findUnique({ where: { portableId: incomingPortableId } });
      const existing = globalMatch?.accountId === accountId ? globalMatch : null;
      const baseFields = noteFields(source, {});
      // Readable formats never change sharing. Existing local sharing remains;
      // new notes are always private.
      let note: any;
      const incomingUpdatedAt = source.updatedAt ? new Date(source.updatedAt).getTime() : 0;
      if (existing && existing.content !== baseFields.content && existing.updatedAt.getTime() > incomingUpdatedAt) {
        note = await db.notes.create({
          data: {
            ...baseFields,
            portableId: randomUUID(),
            accountId,
            metadata: { ...((source.metadata ?? {}) as object), importedConflictOf: incomingPortableId },
            ...sharingFields(source, false),
          },
        });
        result.conflicts++;
        result.created++;
        result.warnings.push(`Kept both versions of memo ${incomingPortableId} because the local copy is newer.`);
      } else if (existing) {
        note = await db.notes.update({ where: { id: existing.id }, data: baseFields });
        result.updated++;
      } else {
        note = await db.notes.create({
          data: { ...baseFields, portableId: globalMatch ? randomUUID() : incomingPortableId, accountId, ...sharingFields(source, false) },
        });
        result.created++;
      }
      noteIdMap.set(source.portableId ?? incomingPortableId, note.id);
      if (Number.isInteger(source.sourceId)) sourceIdMap.set(source.sourceId, note.id);

      const descriptors = source.attachments ?? [];
      const archiveAttachments: Map<string, Buffer> | undefined = source.__archiveAttachments;
      for (const descriptor of descriptors) {
        const buffer = descriptor.archivePath ? archiveAttachments?.get(descriptor.archivePath) : undefined;
        if (buffer) pendingAttachments.push({ notePortableId: source.portableId ?? incomingPortableId, noteId: note.id, descriptor, buffer });
        else {
          result.skipped++;
          result.warnings.push(`Attachment ${descriptor.name ?? descriptor.portableId ?? 'unknown'} has metadata but no binary file and was skipped.`);
        }
      }
    }

    for (const source of sources) {
      const noteId = noteIdMap.get(source.portableId);
      if (!noteId) continue;
      const parentId = source.parentPortableId ? noteIdMap.get(source.parentPortableId) ?? null : null;
      let content = typeof source.content === 'string' ? source.content : '';
      for (const [oldId, newId] of sourceIdMap) {
        content = content.replace(new RegExp(`\\/(?:bkemo\\/)?n\\/${oldId}(?!\\d)`, 'g'), `/n/${newId}`);
      }
      await db.notes.update({ where: { id: noteId }, data: { parentNoteId: parentId, content } });
      for (const portableTagId of source.tagPortableIds ?? []) {
        const tagId = tagIdMap.get(portableTagId);
        if (tagId) await db.tagsToNote.upsert({ where: { noteId_tagId: { noteId, tagId } }, create: { noteId, tagId }, update: {} });
      }
    }

    const references = json?.references ?? sources.flatMap((source) => (source.referencePortableIds ?? []).map((toPortableId: string) => ({ fromPortableId: source.portableId, toPortableId })));
    for (const reference of references) {
      const fromNoteId = noteIdMap.get(reference.fromPortableId);
      const toNoteId = noteIdMap.get(reference.toPortableId);
      if (fromNoteId && toNoteId) {
        await db.noteReference.upsert({ where: { fromNoteId_toNoteId: { fromNoteId, toNoteId } }, create: { fromNoteId, toNoteId }, update: {} });
      }
    }
  }, { maxWait: 10_000, timeout: 120_000 });

  for (const pending of pendingAttachments) {
    try {
      const uploaded = await FileService.uploadFile({
        buffer: pending.buffer,
        originalName: pending.descriptor.name ?? 'attachment',
        type: pending.descriptor.type ?? 'application/octet-stream',
        accountId,
      });
      const created = await prisma.attachments.findFirst({ where: { path: uploaded.storedPath, accountId }, orderBy: { id: 'desc' } });
      if (created) {
        const wantedPortableId = safePortableId(pending.descriptor.portableId);
        const collision = await prisma.attachments.findUnique({ where: { portableId: wantedPortableId } });
        await prisma.attachments.update({
          where: { id: created.id },
          data: { noteId: pending.noteId, portableId: collision && collision.id !== created.id ? randomUUID() : wantedPortableId, sortOrder: pending.descriptor.sortOrder ?? 0, metadata: pending.descriptor.metadata ?? null },
        });
        if (pending.descriptor.archivePath) {
          const note = await prisma.notes.findUnique({ where: { id: pending.noteId }, select: { content: true } });
          if (note?.content.includes(`./${pending.descriptor.archivePath}`)) {
            await prisma.notes.update({ where: { id: pending.noteId }, data: { content: note.content.split(`./${pending.descriptor.archivePath}`).join(uploaded.filePath) } });
          }
        }
      }
    } catch (error: any) {
      result.skipped++;
      result.warnings.push(`Could not restore ${pending.descriptor.name ?? 'attachment'}: ${error?.message ?? 'upload failed'}`);
    }
  }
  if (json?.attachments?.length) {
    result.skipped += json.attachments.length;
    result.warnings.push(`${json.attachments.length} JSON attachment descriptor(s) were not restored because JSON does not contain binaries.`);
  }
  return result;
}

async function restoreBk(
  data: PortableData,
  ctx: Context,
  mode: TransferMode,
  preserveSharing: boolean,
  restoreSiteSettings: boolean,
): Promise<TransferResult> {
  const callerId = Number(ctx.id);
  const caller = await prisma.accounts.findUnique({ where: { id: callerId } });
  if (!caller) throw new Error('Account not found');
  const isSuperadmin = await isFirstSuperadminAccount(callerId);
  if (data.scope === 'site' && !isSuperadmin) throw new Error('Only the first superadmin can restore a full-site backup');
  if (mode === 'replace' && !isSuperadmin) throw new Error('Replace restore requires the superadmin account');
  if ((preserveSharing || restoreSiteSettings) && !isSuperadmin) throw new Error('Only the superadmin can restore sharing or site settings');
  if (restoreSiteSettings && data.scope !== 'site') throw new Error('This backup has no site-settings compartment');

  const result: TransferResult = { created: 0, updated: 0, conflicts: 0, skipped: 0, warnings: [] };
  const accountIdMap = new Map<string, number>();
  const noteIdMap = new Map<string, number>();
  const tagIdMap = new Map<string, number>();
  const conversationIdMap = new Map<string, number>();
  const commentIdMap = new Map<string, number>();
  const pendingAttachments: { source: any; noteId: number | null; accountId: number | null; buffer: Buffer }[] = [];

  await prisma.$transaction(async (db) => {
    if (mode === 'replace') {
      if (data.scope === 'site') {
        if (restoreSiteSettings) await db.accessToken.deleteMany({});
        const targetIds = (await db.accounts.findMany({ select: { id: true } })).map((row: any) => row.id);
        for (const targetId of targetIds) await clearAccountForReplace(db, targetId);
      } else {
        await clearAccountForReplace(db, callerId);
      }
    }

    const sourceOwnerPortableId = data.accounts[0]?.portableId;
    for (const source of data.accounts) {
      if (data.scope === 'account') {
        accountIdMap.set(source.portableId, callerId);
        continue;
      }
      if (source.portableId === sourceOwnerPortableId) {
        accountIdMap.set(source.portableId, callerId);
        if (restoreSiteSettings) {
          await db.accounts.update({
            where: { id: callerId },
            data: {
              name: source.name ?? caller.name,
              email: source.email ?? caller.email,
              nickname: source.nickname ?? caller.nickname,
              password: source.password ?? caller.password,
              image: source.image ?? caller.image,
              apiToken: source.apiToken ?? caller.apiToken,
              description: source.description ?? caller.description,
              loginType: source.loginType ?? caller.loginType,
              role: 'superadmin',
              permissions: source.permissions ?? caller.permissions,
            },
          });
        }
        continue;
      }
      const portableId = safePortableId(source.portableId);
      const byPortable = await db.accounts.findUnique({ where: { portableId } });
      const existing = byPortable ?? await db.accounts.findFirst({ where: { name: source.name ?? '' } });
      const fields = {
        name: source.name ?? 'imported-user',
        email: source.email ?? '',
        nickname: source.nickname ?? source.name ?? 'Imported user',
        password: source.password ?? '',
        image: source.image ?? '',
        description: source.description ?? '',
        note: source.note ?? 0,
        role: restoreSiteSettings && source.role === 'admin' ? 'admin' : 'user',
        loginType: source.loginType ?? '',
        permissions: source.permissions ?? null,
        ...(restoreSiteSettings && source.apiToken ? { apiToken: source.apiToken } : {}),
      };
      const account = existing
        ? await db.accounts.update({ where: { id: existing.id }, data: fields })
        : await db.accounts.create({ data: { ...fields, portableId } });
      accountIdMap.set(source.portableId, account.id);
    }

    // Account links may point forward to an account that appears later in the
    // archive, so restore them only after every portable account ID is mapped.
    if (data.scope === 'site' && restoreSiteSettings) {
      for (const source of data.accounts) {
        if (!Object.prototype.hasOwnProperty.call(source, 'linkAccountPortableId')) continue;
        const restoredAccountId = accountIdMap.get(source.portableId);
        if (!restoredAccountId) continue;
        const linkedAccountId = source.linkAccountPortableId
          ? accountIdMap.get(source.linkAccountPortableId) ?? null
          : null;
        if (source.linkAccountPortableId && !linkedAccountId) {
          result.warnings.push(`Could not restore the linked account for ${source.portableId}.`);
        }
        await db.accounts.update({
          where: { id: restoredAccountId },
          data: { linkAccountId: linkedAccountId },
        });
      }
    }

    for (const source of data.tags) {
      const accountId = accountIdMap.get(source.accountPortableId) ?? callerId;
      const portableId = safePortableId(source.portableId);
      const byPortable = await db.tag.findUnique({ where: { portableId } });
      const existing = byPortable?.accountId === accountId ? byPortable : await db.tag.findFirst({ where: { accountId, name: source.name ?? 'Imported' } });
      const tag = existing
        ? await db.tag.update({ where: { id: existing.id }, data: { name: source.name ?? existing.name, icon: source.icon ?? '', sortOrder: source.sortOrder ?? 0 } })
        : await db.tag.create({ data: { portableId: byPortable ? randomUUID() : portableId, accountId, name: source.name ?? 'Imported', icon: source.icon ?? '', parent: 0, sortOrder: source.sortOrder ?? 0 } });
      tagIdMap.set(source.portableId, tag.id);
    }
    for (const source of data.tags) {
      const tagId = tagIdMap.get(source.portableId);
      const parent = source.parentPortableId ? tagIdMap.get(source.parentPortableId) ?? 0 : 0;
      if (tagId) await db.tag.update({ where: { id: tagId }, data: { parent } });
    }

    for (const source of data.notes) {
      const accountId = accountIdMap.get(source.accountPortableId) ?? callerId;
      const portableId = safePortableId(source.portableId);
      const globalMatch = await db.notes.findUnique({ where: { portableId } });
      const existing = globalMatch?.accountId === accountId ? globalMatch : null;
      const canImportSharing = isSuperadmin && preserveSharing;
      let importedSharing = canImportSharing
        ? await ensureShareSlugAvailable(db, source, existing?.id ?? null, result)
        : sharingFields(source, false);
      // A regular user's merge cannot edit sharing in either direction.
      if (!isSuperadmin && existing) importedSharing = {};
      const fields = noteFields(source, importedSharing);
      const incomingUpdatedAt = source.updatedAt ? new Date(source.updatedAt).getTime() : 0;
      let note: any;
      if (existing && existing.content !== fields.content && existing.updatedAt.getTime() > incomingUpdatedAt) {
        note = await db.notes.create({
          data: {
            ...fields,
            portableId: randomUUID(),
            accountId,
            metadata: { ...((source.metadata ?? {}) as object), importedConflictOf: portableId },
            ...sharingFields(source, false),
          },
        });
        result.conflicts++;
        result.created++;
        result.warnings.push(`Kept both versions of memo ${portableId} because the local copy is newer.`);
      } else if (existing) {
        note = await db.notes.update({ where: { id: existing.id }, data: fields });
        result.updated++;
      } else {
        note = await db.notes.create({ data: { ...fields, portableId: globalMatch ? randomUUID() : portableId, accountId } });
        result.created++;
      }
      noteIdMap.set(source.portableId, note.id);
    }

    const sourceIdMap = new Map<number, number>();
    for (const source of data.notes) {
      const noteId = noteIdMap.get(source.portableId);
      if (noteId && Number.isInteger(source.sourceId)) sourceIdMap.set(source.sourceId, noteId);
    }
    for (const source of data.notes) {
      const noteId = noteIdMap.get(source.portableId);
      if (!noteId) continue;
      const parentNoteId = source.parentPortableId ? noteIdMap.get(source.parentPortableId) ?? null : null;
      let content = typeof source.content === 'string' ? source.content : '';
      for (const [oldId, newId] of sourceIdMap) content = content.replace(new RegExp(`\\/(?:bkemo\\/)?n\\/${oldId}(?!\\d)`, 'g'), `/n/${newId}`);
      await db.notes.update({ where: { id: noteId }, data: { parentNoteId, content } });
    }
    for (const relation of data.tagsToNote) {
      const noteId = noteIdMap.get(relation.notePortableId);
      const tagId = tagIdMap.get(relation.tagPortableId);
      if (noteId && tagId) await db.tagsToNote.upsert({ where: { noteId_tagId: { noteId, tagId } }, create: { noteId, tagId }, update: {} });
    }
    for (const reference of data.references) {
      const fromNoteId = noteIdMap.get(reference.fromPortableId);
      const toNoteId = noteIdMap.get(reference.toPortableId);
      if (fromNoteId && toNoteId) await db.noteReference.upsert({ where: { fromNoteId_toNoteId: { fromNoteId, toNoteId } }, create: { fromNoteId, toNoteId, createdAt: new Date(reference.createdAt) }, update: {} });
    }

    for (const source of data.attachments) {
      if (!source.__buffer || source.binaryMissing) {
        result.skipped++;
        result.warnings.push(`Attachment ${source.name ?? source.portableId} has no verified binary and was skipped.`);
        continue;
      }
      pendingAttachments.push({
        source,
        noteId: source.notePortableId ? noteIdMap.get(source.notePortableId) ?? null : null,
        accountId: source.accountPortableId ? accountIdMap.get(source.accountPortableId) ?? null : null,
        buffer: source.__buffer,
      });
    }

    for (const source of data.comments) {
      const noteId = noteIdMap.get(source.notePortableId);
      if (!noteId) continue;
      const portableId = safePortableId(source.portableId);
      const existing = await db.comments.findUnique({ where: { portableId } });
      const fields = {
        noteId,
        accountId: source.accountPortableId ? accountIdMap.get(source.accountPortableId) ?? null : null,
        content: source.content ?? '',
        guestName: source.guestName ?? null,
        guestAvatar: source.guestAvatar ?? null,
        guestIP: null,
        guestUA: null,
        createdAt: source.createdAt ? new Date(source.createdAt) : new Date(),
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date(),
      };
      const comment = existing
        ? await db.comments.update({ where: { id: existing.id }, data: fields })
        : await db.comments.create({ data: { ...fields, portableId } });
      commentIdMap.set(source.portableId, comment.id);
    }
    for (const source of data.comments) {
      const id = commentIdMap.get(source.portableId);
      const parentId = source.parentPortableId ? commentIdMap.get(source.parentPortableId) ?? null : null;
      if (id) await db.comments.update({ where: { id }, data: { parentId } });
    }

    for (const source of data.reactions) {
      const noteId = noteIdMap.get(source.notePortableId);
      if (noteId && source.emoji && source.guestId) {
        await db.reaction.upsert({ where: { noteId_emoji_guestId: { noteId, emoji: source.emoji, guestId: source.guestId } }, create: { noteId, emoji: source.emoji, guestId: source.guestId, createdAt: source.createdAt ? new Date(source.createdAt) : new Date() }, update: {} });
      }
    }
    for (const source of data.histories) {
      const noteId = noteIdMap.get(source.notePortableId);
      if (!noteId) continue;
      const portableId = safePortableId(source.portableId);
      const fields = { noteId, accountId: source.accountPortableId ? accountIdMap.get(source.accountPortableId) ?? null : null, content: source.content ?? '', metadata: source.metadata ?? null, version: source.version ?? 1, createdAt: source.createdAt ? new Date(source.createdAt) : new Date() };
      await db.noteHistory.upsert({ where: { portableId }, create: { ...fields, portableId }, update: fields });
    }

    if (isSuperadmin && preserveSharing && data.scope === 'site') {
      for (const source of data.internalShares) {
        const noteId = noteIdMap.get(source.notePortableId);
        const accountId = accountIdMap.get(source.targetAccountPortableId);
        if (noteId && accountId) await db.noteInternalShare.upsert({ where: { noteId_accountId: { noteId, accountId } }, create: { noteId, accountId, canEdit: source.canEdit ?? true }, update: { canEdit: source.canEdit ?? true } });
      }
    }

    for (const source of data.configs) {
      const userId = source.accountPortableId ? accountIdMap.get(source.accountPortableId) ?? null : null;
      if (!userId && !(isSuperadmin && restoreSiteSettings)) continue;
      const existing = await db.config.findFirst({ where: { key: source.key, userId } });
      if (existing) await db.config.update({ where: { id: existing.id }, data: { config: source.config } });
      else await db.config.create({ data: { key: source.key, config: source.config, userId } });
    }

    if (isSuperadmin && restoreSiteSettings && data.scope === 'site') {
      for (const source of data.accessTokens ?? []) {
        const accountId = accountIdMap.get(source.accountPortableId);
        if (!accountId || !source.jti) continue;
        const fields = {
          accountId,
          name: source.name ?? '',
          scopes: source.scopes ?? null,
          preview: source.preview ?? '',
          lastUsedAt: source.lastUsedAt ? new Date(source.lastUsedAt) : null,
          expiresAt: source.expiresAt ? new Date(source.expiresAt) : null,
          createdAt: source.createdAt ? new Date(source.createdAt) : new Date(),
        };
        await db.accessToken.upsert({ where: { jti: source.jti }, create: { ...fields, jti: source.jti }, update: fields });
      }
    }

    for (const source of data.follows) {
      const accountId = accountIdMap.get(source.accountPortableId);
      if (!accountId) continue;
      const portableId = safePortableId(source.portableId);
      const fields = { accountId, siteName: source.siteName ?? null, siteUrl: source.siteUrl ?? '', siteAvatar: source.siteAvatar ?? null, description: source.description ?? null, followType: source.followType ?? 'following', createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
      await db.follows.upsert({ where: { portableId }, create: { ...fields, portableId }, update: fields });
    }
    for (const source of data.notifications) {
      const accountId = accountIdMap.get(source.accountPortableId);
      if (!accountId) continue;
      const portableId = safePortableId(source.portableId);
      const fields = { accountId, type: source.type ?? 'system', title: source.title ?? '', content: source.content ?? '', metadata: source.metadata ?? null, isRead: !!source.isRead, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
      await db.notifications.upsert({ where: { portableId }, create: { ...fields, portableId }, update: fields });
    }
    for (const source of data.conversations) {
      const accountId = accountIdMap.get(source.accountPortableId);
      if (!accountId) continue;
      const portableId = safePortableId(source.portableId);
      const fields = { accountId, title: source.title ?? '', isShare: isSuperadmin && preserveSharing ? !!source.isShare : false, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
      const conversation = await db.conversation.upsert({ where: { portableId }, create: { ...fields, portableId }, update: fields });
      conversationIdMap.set(source.portableId, conversation.id);
    }
    for (const source of data.messages) {
      const conversationId = conversationIdMap.get(source.conversationPortableId);
      if (!conversationId) continue;
      const portableId = safePortableId(source.portableId);
      const fields = { conversationId, content: source.content ?? '', role: source.role ?? 'user', metadata: source.metadata ?? null, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
      await db.message.upsert({ where: { portableId }, create: { ...fields, portableId }, update: fields });
    }
    for (const source of data.aiScheduledTasks) {
      const accountId = accountIdMap.get(source.accountPortableId);
      if (!accountId) continue;
      const portableId = safePortableId(source.portableId);
      const fields = { accountId, name: source.name ?? '', prompt: source.prompt ?? '', schedule: source.schedule ?? '', isEnabled: !!source.isEnabled, lastRun: source.lastRun ? new Date(source.lastRun) : null, lastResult: source.lastResult ?? null, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
      await db.aiScheduledTask.upsert({ where: { portableId }, create: { ...fields, portableId }, update: fields });
    }

    if (isSuperadmin && restoreSiteSettings && data.site) {
      for (const source of data.site.plugins) {
        const existing = await db.plugin.findFirst({ where: { path: source.path } });
        const fields = { metadata: source.metadata, path: source.path, isUse: source.isUse ?? true, isDev: source.isDev ?? false, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
        if (existing) await db.plugin.update({ where: { id: existing.id }, data: fields });
        else await db.plugin.create({ data: fields });
      }
      const providerIdMap = new Map<string, number>();
      for (const source of data.site.aiProviders) {
        const existing = await db.aiProviders.findFirst({ where: { provider: source.provider, title: source.title } });
        const fields = { title: source.title, provider: source.provider, baseURL: source.baseURL ?? null, apiKey: source.apiKey ?? null, config: source.config ?? null, sortOrder: source.sortOrder ?? 0, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
        const provider = existing ? await db.aiProviders.update({ where: { id: existing.id }, data: fields }) : await db.aiProviders.create({ data: fields });
        providerIdMap.set(source.portableKey, provider.id);
      }
      for (const source of data.site.aiModels) {
        const providerId = providerIdMap.get(source.providerPortableKey);
        if (!providerId) continue;
        const existing = await db.aiModels.findFirst({ where: { providerId, modelKey: source.modelKey } });
        const fields = { providerId, title: source.title, modelKey: source.modelKey, capabilities: source.capabilities ?? [], config: source.config ?? null, sortOrder: source.sortOrder ?? 0, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
        if (existing) await db.aiModels.update({ where: { id: existing.id }, data: fields });
        else await db.aiModels.create({ data: fields });
      }
      for (const source of data.site.mcpServers) {
        const existing = await db.mcpServers.findFirst({ where: { name: source.name, type: source.type } });
        const fields = { name: source.name, description: source.description ?? null, type: source.type, command: source.command ?? null, args: source.args ?? null, url: source.url ?? null, env: source.env ?? null, headers: source.headers ?? null, isEnabled: source.isEnabled ?? true, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
        if (existing) await db.mcpServers.update({ where: { id: existing.id }, data: fields });
        else await db.mcpServers.create({ data: fields });
      }
      for (const source of data.site.fonts) {
        const fields = { displayName: source.displayName, url: source.url ?? null, fileData: source.fileDataBase64 ? Buffer.from(source.fileDataBase64, 'base64') : null, isLocal: !!source.isLocal, isSystem: !!source.isSystem, weights: source.weights ?? [], category: source.category ?? 'sans-serif', sortOrder: source.sortOrder ?? 0, createdAt: source.createdAt ? new Date(source.createdAt) : new Date(), updatedAt: source.updatedAt ? new Date(source.updatedAt) : new Date() };
        await db.fonts.upsert({ where: { name: source.name }, create: { name: source.name, ...fields }, update: fields });
      }
    }
  }, { maxWait: 10_000, timeout: 120_000 });

  const restoredPathMap = new Map<string, string>();
  for (const pending of pendingAttachments) {
    try {
      const storageAccountId = pending.accountId ?? callerId;
      const uploaded = await FileService.uploadFile({
        buffer: pending.buffer,
        originalName: pending.source.name ?? 'attachment',
        type: pending.source.type ?? 'application/octet-stream',
        accountId: storageAccountId,
        metadata: pending.source.metadata ?? undefined,
      });
      const generated = await prisma.attachments.findFirst({ where: { path: uploaded.storedPath, accountId: storageAccountId }, orderBy: { id: 'desc' } });
      if (!generated) throw new Error('Uploaded attachment record was not created');
      const portableId = safePortableId(pending.source.portableId);
      const existing = await prisma.attachments.findUnique({ where: { portableId } });
      const fields = {
        path: uploaded.storedPath,
        name: pending.source.name ?? generated.name,
        size: pending.source.size ?? generated.size,
        type: pending.source.type ?? generated.type,
        noteId: pending.noteId,
        accountId: pending.accountId,
        isShare: isSuperadmin && preserveSharing ? !!pending.source.isShare : false,
        sharePassword: isSuperadmin && preserveSharing ? pending.source.sharePassword ?? '' : '',
        sortOrder: pending.source.sortOrder ?? 0,
        metadata: pending.source.metadata ?? null,
        createdAt: pending.source.createdAt ? new Date(pending.source.createdAt) : new Date(),
        updatedAt: pending.source.updatedAt ? new Date(pending.source.updatedAt) : new Date(),
      };
      if (existing && existing.id !== generated.id) {
        await prisma.attachments.update({ where: { id: existing.id }, data: fields });
        await prisma.attachments.delete({ where: { id: generated.id } });
      } else {
        await prisma.attachments.update({ where: { id: generated.id }, data: { ...fields, portableId } });
      }
      restoredPathMap.set(pending.source.path, uploaded.filePath);
    } catch (error: any) {
      result.skipped++;
      result.warnings.push(`Could not restore ${pending.source.name ?? 'attachment'}: ${error?.message ?? 'upload failed'}`);
    }
  }

  for (const [oldPath, newPath] of restoredPathMap) {
    if (!oldPath || oldPath === newPath) continue;
    const affectedNotes = await prisma.notes.findMany({ where: { id: { in: [...noteIdMap.values()] }, content: { contains: oldPath } }, select: { id: true, content: true } });
    for (const note of affectedNotes) await prisma.notes.update({ where: { id: note.id }, data: { content: note.content.split(oldPath).join(newPath) } });
    await prisma.accounts.updateMany({ where: { id: { in: [...new Set(accountIdMap.values())] }, image: oldPath }, data: { image: newPath } });
    await prisma.comments.updateMany({ where: { id: { in: [...commentIdMap.values()] }, guestAvatar: oldPath }, data: { guestAvatar: newPath } });
  }
  return result;
}

export async function importTransfer(
  filePath: string,
  passphrase: string | undefined,
  ctx: Context,
  options: { mode: TransferMode; preserveSharing: boolean; restoreSiteSettings: boolean },
): Promise<TransferResult> {
  const isFirstSuperadmin = await isFirstSuperadminAccount(Number(ctx.id));
  if (options.mode === 'replace' && !isFirstSuperadmin) {
    throw new Error('Replace restore requires the first superadmin account');
  }
  if ((options.preserveSharing || options.restoreSiteSettings) && !isFirstSuperadmin) {
    throw new Error('Only the first superadmin can restore sharing or site settings');
  }
  const loaded = await loadImport(filePath, passphrase);
  if (loaded.scope === 'site' && !isFirstSuperadmin) {
    throw new Error('Only the first superadmin can restore a full-site backup');
  }
  if (loaded.format === 'bk') {
    return restoreBk(loaded.data as PortableData, ctx, options.mode, options.preserveSharing, options.restoreSiteSettings);
  }
  return restoreReadable(loaded, ctx, options.mode);
}

export async function importRecoveryKey(accountId: number, filePath: string, passphrase: string): Promise<string> {
  if (!(await isFirstSuperadminAccount(accountId))) throw new Error('Only the first superadmin can import the recovery key');
  return installRecoveryKeyFile(await readFile(filePath), passphrase);
}
