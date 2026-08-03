/** Sidebar editor state for O3 guarded edits. */
export type SidebarEditorState = {
  portableId: string;
  expectedRevision: number;
  draft: string;
  dirty: boolean;
  status: 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict';
};

export function createEditorState(portableId: string, revision: number, content: string): SidebarEditorState {
  return {
    portableId,
    expectedRevision: revision,
    draft: content,
    dirty: false,
    status: 'clean',
  };
}
