import { describe, expect, test } from 'vitest';
import { runtimeDatabaseUrl } from '../../../lib/runtimeDatabaseUrl';

describe('runtimeDatabaseUrl', () => {
  test('caps pooled Neon connections when no explicit limit exists', () => {
    const result = new URL(runtimeDatabaseUrl(
      'postgresql://owner:secret@ep-example-pooler.us-east-1.aws.neon.tech/bkemo?sslmode=require',
    )!);

    expect(result.searchParams.get('connection_limit')).toBe('2');
    expect(result.searchParams.get('sslmode')).toBe('require');
  });

  test('preserves an explicit connection limit', () => {
    const result = new URL(runtimeDatabaseUrl(
      'postgresql://owner:secret@ep-example-pooler.us-east-1.aws.neon.tech/bkemo?connection_limit=4',
    )!);

    expect(result.searchParams.get('connection_limit')).toBe('4');
  });

  test('does not modify local or direct database URLs', () => {
    expect(runtimeDatabaseUrl('postgresql://localhost:5433/bkemo')).toBe('postgresql://localhost:5433/bkemo');
    expect(runtimeDatabaseUrl('postgresql://owner:secret@ep-example.us-east-1.aws.neon.tech/bkemo'))
      .toBe('postgresql://owner:secret@ep-example.us-east-1.aws.neon.tech/bkemo');
  });
});
