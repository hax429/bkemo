import { describe, expect, test } from 'bun:test';
import { isAllowedRedirectUri, parseRequestedScopes, pkceS256, sha256 } from '../../../lib/mcpOAuth';

describe('MCP OAuth primitives', () => {
  test('allows HTTPS and localhost redirects only', () => {
    expect(isAllowedRedirectUri('https://client.example/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3333/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:3333/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://client.example/callback')).toBe(false);
    expect(isAllowedRedirectUri('https://client.example/callback#fragment')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
  });

  test('accepts recognized scopes and rejects partial scope sets', () => {
    expect(parseRequestedScopes('notes:read tags:read')).toEqual(['notes:read', 'tags:read']);
    expect(() => parseRequestedScopes('notes:read admin')).toThrow('invalid_scope');
    expect(() => parseRequestedScopes('analytics:read')).toThrow('invalid_scope');
    expect(() => parseRequestedScopes('')).not.toThrow();
  });

  test('uses OAuth PKCE S256 encoding', () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
    expect(pkceS256(verifier)).toBe('ImpiCd8pp4MveCNnbIS7-GXEtB0xF5HMIDoWqvGA5ig');
    expect(sha256('token')).toHaveLength(64);
  });
});
