import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEditorDraft,
  createEditorState,
  editorStatusLabel,
  markEditorConflict,
  markEditorSaved,
  markEditorSaving,
} from './editor.js';

describe('sidebar editor state', () => {
  it('tracks dirty drafts against the baseline', () => {
    const state = createEditorState('id', 3, 'hello');
    assert.equal(state.dirty, false);
    const dirty = applyEditorDraft(state, 'hello world');
    assert.equal(dirty.dirty, true);
    assert.equal(dirty.status, 'dirty');
    assert.equal(applyEditorDraft(dirty, 'hello').dirty, false);
  });

  it('marks saving, saved, and conflict transitions', () => {
    let state = createEditorState('id', 1, 'a');
    state = applyEditorDraft(state, 'b');
    state = markEditorSaving(state);
    assert.equal(state.status, 'saving');
    state = markEditorSaved(state, { content: 'b', revision: 2 });
    assert.equal(state.expectedRevision, 2);
    assert.equal(state.dirty, false);
    assert.equal(state.status, 'saved');
    state = markEditorConflict(applyEditorDraft(state, 'c'));
    assert.equal(state.status, 'conflict');
    assert.equal(editorStatusLabel('conflict'), 'conflict');
  });
});
