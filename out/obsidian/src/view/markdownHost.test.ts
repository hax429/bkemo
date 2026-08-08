import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdownHostClasses } from './markdownHost.js';

describe('sidebar markdown host', () => {
  it('uses rendered markdown styling without impersonating a full reading view', () => {
    const classes: readonly string[] = markdownHostClasses;
    assert.ok(classes.includes('markdown-rendered'));
    assert.ok(classes.includes('bkemo-md'));
    assert.ok(!classes.includes('markdown-preview-view'));
  });
});
