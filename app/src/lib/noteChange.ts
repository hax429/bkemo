import type { Note } from '@shared/lib/types';

export async function applyExternalNoteChange(
  note: Note & { isOffline?: boolean },
  actions: {
    cache: (notes: Note[]) => Promise<unknown>;
    reloadOffline: () => void;
    invalidate: () => void;
  },
): Promise<void> {
  if (note?.isOffline) {
    actions.reloadOffline();
  } else if (note?.id != null) {
    await actions.cache([note]);
  }
  actions.invalidate();
}
