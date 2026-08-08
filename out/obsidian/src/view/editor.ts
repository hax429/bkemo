/** Sidebar editor state for O3 guarded edits. */
export type SidebarEditorState = {
  portableId: string;
  expectedRevision: number;
  draft: string;
  baseline: string;
  dirty: boolean;
  status: 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict';
};

export function createEditorState(portableId: string, revision: number, content: string): SidebarEditorState {
  return {
    portableId,
    expectedRevision: revision,
    draft: content,
    baseline: content,
    dirty: false,
    status: 'clean',
  };
}

export function applyEditorDraft(state: SidebarEditorState, draft: string): SidebarEditorState {
  const dirty = draft !== state.baseline;
  return {
    ...state,
    draft,
    dirty,
    status: state.status === 'conflict' ? 'conflict' : dirty ? 'dirty' : 'clean',
  };
}

export function markEditorSaving(state: SidebarEditorState): SidebarEditorState {
  return { ...state, status: 'saving' };
}

export function markEditorSaved(
  state: SidebarEditorState,
  next: { content: string; revision: number },
): SidebarEditorState {
  return {
    ...state,
    expectedRevision: next.revision,
    draft: next.content,
    baseline: next.content,
    dirty: false,
    status: 'saved',
  };
}

export function markEditorConflict(state: SidebarEditorState): SidebarEditorState {
  return { ...state, status: 'conflict', dirty: true };
}

export function editorStatusLabel(status: SidebarEditorState['status']): string {
  switch (status) {
    case 'dirty':
      return 'edited';
    case 'saving':
      return 'saving…';
    case 'saved':
      return 'saved';
    case 'conflict':
      return 'conflict';
    default:
      return '';
  }
}
