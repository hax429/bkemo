import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAccessToken, looksLikePairingCode } from './credentialShape.js';

describe('credential shape detection', () => {
  it('detects JWTs and pairing codes', () => {
    assert.equal(looksLikeAccessToken('aaaa.bbbb.cccc'), true);
    assert.equal(looksLikeAccessToken('ABCD-EFGH'), false);
    assert.equal(looksLikePairingCode('ABCD-EFGH'), true);
    assert.equal(looksLikePairingCode('aaaa.bbbb.cccc'), false);
  });
});
