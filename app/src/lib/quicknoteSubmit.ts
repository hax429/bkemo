type ModifierEnterEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
};

export function isModifierEnter(event: ModifierEnterEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter';
}

type DeliverQuickNoteOptions<T> = {
  save: () => Promise<T | null | undefined>;
  clear: () => void;
  hide: () => Promise<void> | void;
};

export async function deliverQuickNote<T>({
  save,
  clear,
  hide,
}: DeliverQuickNoteOptions<T>): Promise<T> {
  const saved = await save();
  if (saved == null) {
    throw new Error('Quick note was not accepted by bkemo');
  }

  clear();
  await hide();
  return saved;
}
