type ModifierEnterEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
};

export function isModifierEnter(event: ModifierEnterEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter';
}

type DeliverQuickNoteOptions<T> = {
  enqueue: () => Promise<T | null | undefined> | T | null | undefined;
  clear: () => void;
  hide: () => Promise<void> | void;
};

/** Hide immediately, persist the upload, then clear the composer. */
export function deliverQuickNote<T>({
  enqueue,
  clear,
  hide,
}: DeliverQuickNoteOptions<T>): Promise<T> {
  void hide();
  return Promise.resolve(enqueue()).then((saved) => {
    if (saved == null) {
      throw new Error('Quick note was not accepted by bkemo');
    }
    clear();
    return saved;
  });
}
