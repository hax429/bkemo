/**
 * Embeddable Obsidian markdown editor for ItemViews.
 * Based on mgmeyers / Fevol's ScrollableMarkdownEditor prototype pattern.
 */
import { App, Scope, type TFile } from 'obsidian';
import { EditorSelection, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, type ViewUpdate } from '@codemirror/view';

export type EmbeddableEditorOptions = {
  value?: string;
  placeholder?: string;
  cls?: string;
  onChange?: (value: string) => void;
  /** Return true to consume the key. */
  onModEnter?: (value: string) => boolean;
};

type WidgetEditorViewLike = {
  editable: boolean;
  showEditor: () => void;
  editMode?: any;
  unload: () => void;
};

export type EmbeddableMarkdownEditor = {
  editor: { cm: EditorView };
  editorEl: HTMLElement;
  _loaded: boolean;
  set: (data: string, clear?: boolean) => void;
  unload: () => void;
  getValue: () => string;
  focus: () => void;
  destroy: () => void;
};

let cachedEditorCtor: any = null;

function resolveMarkdownEditorClass(app: App): any {
  if (cachedEditorCtor) return cachedEditorCtor;

  const embedRegistry = (app as unknown as {
    embedRegistry?: {
      embedByExtension?: Record<
        string,
        (ctx: { app: App; containerEl: HTMLElement }, file: TFile | null, path: string) => WidgetEditorViewLike
      >;
    };
  }).embedRegistry;

  const factory = embedRegistry?.embedByExtension?.md;
  if (!factory) {
    throw new Error('Obsidian markdown editor is unavailable in this build');
  }

  const widget = factory({ app, containerEl: document.createElement('div') }, null, '');
  widget.editable = true;
  widget.showEditor();
  const editMode = widget.editMode;
  if (!editMode) {
    widget.unload();
    throw new Error('Failed to resolve Obsidian markdown editor prototype');
  }

  const ctor = Object.getPrototypeOf(Object.getPrototypeOf(editMode)).constructor;
  widget.unload();
  cachedEditorCtor = ctor;
  return ctor;
}

export function canEmbedObsidianEditor(app: App): boolean {
  try {
    resolveMarkdownEditorClass(app);
    return true;
  } catch {
    return false;
  }
}

export function createEmbeddableMarkdownEditor(
  app: App,
  container: HTMLElement,
  options: EmbeddableEditorOptions = {},
): EmbeddableMarkdownEditor {
  const opts: EmbeddableEditorOptions = { ...options };
  const MarkdownEditor: any = resolveMarkdownEditorClass(app);
  const scope = new Scope(app.scope);
  const owner: Record<string, unknown> = {
    app,
    onMarkdownScroll: () => {},
    getMode: () => 'source',
  };

  const Editor = class extends MarkdownEditor {
    buildLocalExtensions(): Extension[] {
      const extensions = super.buildLocalExtensions();
      if (opts.placeholder) extensions.push(placeholderExt(opts.placeholder));
      extensions.push(
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => opts.onModEnter?.(this.getValue()) ?? false,
            },
          ]),
        ),
      );
      return extensions;
    }

    onUpdate(update: ViewUpdate, changed: boolean) {
      super.onUpdate(update, changed);
      if (changed) opts.onChange?.(this.getValue());
    }

    getValue(): string {
      return this.editor.cm.state.doc.toString();
    }
  };

  const editor = new (Editor as any)(app, container, owner) as EmbeddableMarkdownEditor;
  owner.editMode = editor;
  owner.editor = editor.editor;

  scope.register(['Mod'], 'Enter', () => true);

  const cm = editor.editor.cm;
  cm.contentDOM.addEventListener('focusin', () => {
    app.keymap.pushScope(scope);
    (app.workspace as any).activeEditor = owner;
  });
  cm.contentDOM.addEventListener('blur', () => {
    app.keymap.popScope(scope);
  });

  if (opts.cls) editor.editorEl.addClass(opts.cls);
  editor.set(opts.value || '', true);
  cm.dispatch({
    selection: EditorSelection.cursor(cm.state.doc.length),
  });

  editor.getValue = () => cm.state.doc.toString();
  editor.focus = () => cm.focus();
  editor.destroy = () => {
    try {
      app.keymap.popScope(scope);
    } catch {
      // ignore
    }
    if ((app.workspace as any).activeEditor === owner) {
      (app.workspace as any).activeEditor = null;
    }
    try {
      if (editor._loaded) editor.unload();
    } catch {
      // ignore teardown races
    }
    container.empty();
  };

  return editor;
}
