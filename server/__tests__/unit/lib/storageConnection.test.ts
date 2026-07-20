import { describe, expect, test } from 'bun:test';
import {
  isCloudflareR2Endpoint,
  normalizeS3Endpoint,
  normalizeR2EndpointForBucket,
  normalizeStoragePrefix,
  normalizeStorageSettings,
} from '../../../lib/storageConnection';

describe('storage connection settings', () => {
  test('normalizes local and S3 folder prefixes', () => {
    expect(normalizeStoragePrefix(' /bkemo//production/ ')).toBe('bkemo/production');
    expect(normalizeStoragePrefix('bkemo\\files')).toBe('bkemo/files');
    expect(normalizeStoragePrefix('')).toBe('');
  });

  test('rejects traversal in a storage prefix', () => {
    expect(() => normalizeStoragePrefix('../outside')).toThrow('relative path');
    expect(() => normalizeStoragePrefix('files/./today')).toThrow('relative path');
  });

  test('normalizes and validates S3 endpoints', () => {
    expect(normalizeS3Endpoint('https://s3.example.com/')).toBe('https://s3.example.com');
    expect(normalizeS3Endpoint('')).toBe('');
    expect(() => normalizeS3Endpoint('ftp://s3.example.com')).toThrow('http:// or https://');
    expect(() => normalizeS3Endpoint('https://key:secret@s3.example.com')).toThrow('access-key fields');
  });

  test('recognizes and normalizes Cloudflare R2 endpoints', () => {
    const base = 'https://eb39d8ec97c1b34f475aff338b16e573.r2.cloudflarestorage.com';
    expect(isCloudflareR2Endpoint(base)).toBe(true);
    expect(normalizeR2EndpointForBucket(`${base}/bkemo`, 'bkemo')).toBe(base);
    expect(() => normalizeR2EndpointForBucket(`${base}/wrong-bucket`, 'bkemo')).toThrow('must not contain a path');
  });

  test('requires S3 credentials as a pair', () => {
    expect(() => normalizeStorageSettings({
      provider: 's3',
      region: 'us-east-1',
      bucket: 'bkemo',
      accessKeyId: 'key',
    })).toThrow('provided together');
  });

  test('preserves provider-specific settings', () => {
    expect(normalizeStorageSettings({
      provider: 's3',
      endpoint: 'http://localhost:9000/',
      region: 'us-east-1',
      bucket: 'bkemo',
      prefix: '/production/',
      forcePathStyle: false,
    })).toEqual({
      provider: 's3',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'bkemo',
      accessKeyId: '',
      secretAccessKey: '',
      prefix: 'production',
      forcePathStyle: false,
    });
  });

  test('uses the R2 auto region and accepts a pasted bucket path', () => {
    expect(normalizeStorageSettings({
      provider: 's3',
      endpoint: 'https://eb39d8ec97c1b34f475aff338b16e573.r2.cloudflarestorage.com/bkemo',
      region: 'us-east-1',
      bucket: 'bkemo',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    })).toMatchObject({
      endpoint: 'https://eb39d8ec97c1b34f475aff338b16e573.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'bkemo',
    });
  });
});
