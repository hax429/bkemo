import { describe, expect, test } from 'bun:test';
import { assertSafeOutboundUrlSync, isPrivateOrSpecialIp } from '../../../lib/safeOutboundUrl';

describe('assertSafeOutboundUrlSync', () => {
  test('allows public https URLs', () => {
    const result = assertSafeOutboundUrlSync('https://example.com/page');
    expect(result.ok).toBe(true);
  });

  test('rejects non-http schemes', () => {
    expect(assertSafeOutboundUrlSync('file:///etc/passwd').ok).toBe(false);
    expect(assertSafeOutboundUrlSync('ftp://example.com').ok).toBe(false);
  });

  test('rejects localhost and private IPs', () => {
    expect(assertSafeOutboundUrlSync('http://localhost/x').ok).toBe(false);
    expect(assertSafeOutboundUrlSync('http://127.0.0.1/x').ok).toBe(false);
    expect(assertSafeOutboundUrlSync('http://10.0.0.1/x').ok).toBe(false);
    expect(assertSafeOutboundUrlSync('http://192.168.1.1/x').ok).toBe(false);
    expect(assertSafeOutboundUrlSync('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(assertSafeOutboundUrlSync('http://[::1]/').ok).toBe(false);
  });

  test('rejects URLs with embedded credentials', () => {
    expect(assertSafeOutboundUrlSync('https://user:pass@example.com').ok).toBe(false);
  });
});

describe('isPrivateOrSpecialIp', () => {
  test('rejects private IPv4, IPv6, and IPv4-mapped addresses', () => {
    expect(isPrivateOrSpecialIp('10.1.2.3')).toBe(true);
    expect(isPrivateOrSpecialIp('::1')).toBe(true);
    expect(isPrivateOrSpecialIp('::ffff:192.168.1.2')).toBe(true);
    expect(isPrivateOrSpecialIp('1.1.1.1')).toBe(false);
  });
});
