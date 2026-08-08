import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ObjectUrlRegistry,
  attachmentKind,
  formatAttachmentSize,
} from './attachmentPreview.js';

describe('attachmentPreview helpers', () => {
  it('classifies attachment kinds', () => {
    assert.equal(attachmentKind({ portableId: '1', name: 'a.webm', size: 1, type: 'audio/webm' }), 'audio');
    assert.equal(attachmentKind({ portableId: '2', name: 'a.png', size: 1, type: 'image/png' }), 'image');
    assert.equal(attachmentKind({ portableId: '3', name: 'a.bin', size: 1, type: 'application/octet-stream' }), 'file');
  });

  it('formats sizes', () => {
    assert.equal(formatAttachmentSize(512), '512 B');
    assert.equal(formatAttachmentSize(2048), '2.0 KB');
    assert.equal(formatAttachmentSize(2 * 1024 * 1024), '2.0 MB');
  });

  it('tracks and revokes object URLs', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      const url = `blob:test-${created.length}-${blob.size}`;
      created.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url);
    }) as typeof URL.revokeObjectURL;

    try {
      const registry = new ObjectUrlRegistry();
      const first = registry.create(new Blob(['a']));
      const second = registry.create(new Blob(['bb']));
      assert.equal(registry.size, 2);
      registry.revokeAll();
      assert.equal(registry.size, 0);
      assert.deepEqual(created, [first, second]);
      assert.deepEqual(revoked, [first, second]);
      registry.revokeAll();
      assert.deepEqual(revoked, [first, second]);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
