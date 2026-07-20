import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { mkdir, readFile, statfs, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';

export type LocalStorageSettings = {
  provider: 'local';
  localCustomPath?: string;
};

export type S3StorageSettings = {
  provider: 's3';
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
  forcePathStyle?: boolean;
};

export type StorageSettings = LocalStorageSettings | S3StorageSettings;

export type StorageConnectionResult = {
  ok: true;
  provider: 'local' | 's3';
  message: string;
  location: string;
  freeBytes?: number;
};

/** Normalize a configured folder to a safe, relative object/directory prefix. */
export function normalizeStoragePrefix(value?: string): string {
  const normalized = (value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');

  if (!normalized) return '';
  if (normalized.includes('\0') || normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('Storage folder must be a relative path without . or .. segments');
  }
  return normalized;
}

export function normalizeS3Endpoint(value?: string): string {
  const endpoint = (value ?? '').trim().replace(/\/+$/g, '');
  if (!endpoint) return '';
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('S3 endpoint must be a valid http:// or https:// URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('S3 endpoint must use http:// or https://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Put S3 credentials in the access-key fields, not in the endpoint URL');
  }
  return endpoint;
}

export function isCloudflareR2Endpoint(value?: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}

/**
 * Cloudflare displays the account-level endpoint and bucket separately, but a
 * pasted URL often includes `/<bucket>`. The AWS SDK expects the bucket in its
 * Bucket parameter, so accept that one common shape and strip it safely.
 */
export function normalizeR2EndpointForBucket(endpoint: string, bucket: string): string {
  if (!endpoint || !isCloudflareR2Endpoint(endpoint)) return endpoint;
  const parsed = new URL(endpoint);
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (pathParts.length === 0) return endpoint;
  if (pathParts.length === 1 && decodeURIComponent(pathParts[0]) === bucket) {
    parsed.pathname = '/';
    return parsed.toString().replace(/\/$/, '');
  }
  throw new Error('Cloudflare R2 endpoint must not contain a path; enter the bucket in the Bucket field');
}

export function normalizeStorageSettings(settings: StorageSettings): StorageSettings {
  if (settings.provider === 'local') {
    return { provider: 'local', localCustomPath: normalizeStoragePrefix(settings.localCustomPath) };
  }

  const accessKeyId = (settings.accessKeyId ?? '').trim();
  const secretAccessKey = (settings.secretAccessKey ?? '').trim();
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error('Access key ID and secret access key must be provided together');
  }
  const bucket = settings.bucket.trim();
  if (!bucket || bucket.includes('/') || bucket.includes('\\')) {
    throw new Error('S3 bucket is required and cannot contain slashes');
  }
  const endpoint = normalizeR2EndpointForBucket(normalizeS3Endpoint(settings.endpoint), bucket);
  const region = isCloudflareR2Endpoint(endpoint) ? 'auto' : settings.region.trim();
  if (!region) throw new Error('S3 region is required');

  return {
    provider: 's3',
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: normalizeStoragePrefix(settings.prefix),
    forcePathStyle: settings.forcePathStyle !== false,
  };
}

async function testLocalStorage(settings: LocalStorageSettings): Promise<StorageConnectionResult> {
  const prefix = normalizeStoragePrefix(settings.localCustomPath);
  const root = path.resolve(UPLOAD_FILE_PATH);
  const directory = path.resolve(root, prefix || '.');
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) {
    throw new Error('Local storage folder must stay inside the bkemo upload directory');
  }

  await mkdir(directory, { recursive: true });
  const probePath = path.join(directory, `.bkemo-storage-probe-${randomUUID()}`);
  const probe = `bkemo:${randomUUID()}`;
  try {
    await writeFile(probePath, probe, { flag: 'wx', mode: 0o600 });
    const restored = await readFile(probePath, 'utf8');
    if (restored !== probe) throw new Error('Local storage read-back did not match the test payload');
  } finally {
    await unlink(probePath).catch(() => undefined);
  }

  const disk = await statfs(directory).catch(() => null);
  return {
    ok: true,
    provider: 'local',
    message: 'Local storage is writable and readable',
    location: prefix || 'Default uploads directory',
    ...(disk ? { freeBytes: Number(disk.bavail) * Number(disk.bsize) } : {}),
  };
}

export function makeS3Client(settings: S3StorageSettings): S3Client {
  const hasCredentials = !!settings.accessKeyId && !!settings.secretAccessKey;
  return new S3Client({
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    region: settings.region,
    ...(hasCredentials ? {
      credentials: {
        accessKeyId: settings.accessKeyId!,
        secretAccessKey: settings.secretAccessKey!,
      },
    } : {}),
    forcePathStyle: settings.forcePathStyle !== false,
  });
}

async function testS3Storage(settings: S3StorageSettings): Promise<StorageConnectionResult> {
  const normalized = normalizeStorageSettings(settings) as S3StorageSettings;
  const client = makeS3Client(normalized);
  const testKey = [normalized.prefix, `.bkemo-storage-probe-${randomUUID()}.txt`].filter(Boolean).join('/');
  const probe = `bkemo:${randomUUID()}`;
  let uploaded = false;

  try {
    await client.send(new PutObjectCommand({ Bucket: normalized.bucket, Key: testKey, Body: probe, ContentType: 'text/plain' }));
    uploaded = true;
    const response = await client.send(new GetObjectCommand({ Bucket: normalized.bucket, Key: testKey }));
    const restored = await response.Body?.transformToString();
    if (restored !== probe) throw new Error('S3 read-back did not match the test payload');
    await client.send(new DeleteObjectCommand({ Bucket: normalized.bucket, Key: testKey }));
    uploaded = false;
  } finally {
    if (uploaded) {
      await client.send(new DeleteObjectCommand({ Bucket: normalized.bucket, Key: testKey })).catch(() => undefined);
    }
    client.destroy();
  }

  return {
    ok: true,
    provider: 's3',
    message: 'S3 write, read and delete checks passed',
    location: `s3://${normalized.bucket}/${normalized.prefix ?? ''}`.replace(/\/$/, ''),
  };
}

export async function testStorageConnection(settings: StorageSettings): Promise<StorageConnectionResult> {
  const normalized = normalizeStorageSettings(settings);
  return normalized.provider === 'local' ? testLocalStorage(normalized) : testS3Storage(normalized);
}
