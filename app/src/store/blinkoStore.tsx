"use client";
import { useEffect } from 'react';
import { PromisePageState, PromiseState } from './standard/PromiseState';
import { Store } from './standard/base';
import { helper } from '@/lib/helper';
import { ToastPlugin } from './module/Toast/Toast';
import { RootStore } from './root';
import { eventBus } from '@/lib/event';
import { StorageListState } from './standard/StorageListState';
import i18n from '@/lib/i18n';
import { api } from '@/lib/trpc';
import { Attachment, NoteType, type Note } from '@shared/lib/types';
import { ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME } from '@shared/lib/sharedConstant';
import { makeAutoObservable } from 'mobx';
import { UserStore } from './user';
import { BaseStore } from './baseStore';
import { StorageState } from './standard/StorageState';
import { useSearchParams, useLocation } from 'react-router-dom';
import { upsertNotesToCache, queryNotesFromCache, patchNoteInCache, deleteNoteFromCache } from '@/lib/noteCache';

type filterType = {
  label: string;
  sortBy: string;
  direction: string;
}

// Interface for note upsert parameters
interface UpsertNoteParams {
  /** Note content */
  content?: string | null;
  /** Whether the note is archived */
  isArchived?: boolean;
  /** Whether the note is in recycle bin */
  isRecycle?: boolean;
  /** Note type */
  type?: NoteType;
  /** Note ID */
  id?: number;
  /** List of attachments */
  attachments?: Attachment[];
  /** Whether to refresh the list after operation */
  refresh?: boolean;
  /** Whether the note is pinned to top */
  isTop?: boolean;
  /** Whether the note is publicly shared */
  isShare?: boolean;
  /** Whether to show toast notification */
  showToast?: boolean;
  /** List of referenced note IDs */
  references?: number[];
  /** Creation time */
  createdAt?: Date;
  /** Last update time */
  updatedAt?: Date;
  /** Metadata */
  metadata?: any;
  /** Task: due date (null clears it) */
  dueDate?: Date | string | null;
  /** Task: important flag */
  isImportant?: boolean | null;
  /** Task: urgent flag */
  isUrgent?: boolean | null;
  /** Task: completion time (null = not done) */
  completedAt?: Date | string | null;
}

interface OfflineNote extends Omit<Note, 'id' | 'references'> {
  id: number;
  isOffline: boolean;
  pendingSync: boolean;
  references: { toNoteId: number }[];
}

type OfflinePendingOp =
  | { type: 'edit'; noteId: number; patch: Partial<UpsertNoteParams> }
  | { type: 'delete'; noteId: number };

export class BlinkoStore implements Store {
  sid = 'BlinkoStore';
  noteContent = '';
  createContentStorage = new StorageState<{ content: string }>({
    key: 'createModeNote',
    default: { content: '' }
  });
  createAttachmentsStorage = new StorageListState<{ name: string, path: string, type: string, size: number }>({
    key: 'createModeAttachments',
  });
  editContentStorage = new StorageListState<{ content: string, id: number }>({
    key: 'editModeNotes'
  });
  editAttachmentsStorage = new StorageListState<{ name: string, path: string, type: string, size: number, id: number }>({
    key: 'editModeAttachments'
  });

  searchText: string = '';
  isCreateMode: boolean = true
  curSelectedNote: Note | null = null;
  curMultiSelectIds: number[] = [];
  isMultiSelectMode: boolean = false;
  fullscreenEditorNoteId: number | null = null;
  forceQuery: number = 0;
  allTagRouter = {
    title: 'total',
    href: '/?path=all',
    icon: ''
  }
  noteListFilterConfig = {
    isArchived: false as boolean | null,
    isRecycle: false,
    isShare: null as boolean | null,
    type: 0,
    tagId: null as number | null,
    withoutTag: false,
    withFile: false,
    withLink: false,
    isUseAiQuery: false,
    startDate: null as Date | null,
    endDate: null as Date | null,
    hasTodo: false
  }
  noteTypeDefault: NoteType = NoteType.BLINKO
  currentCommonFilter: filterType | null = null
  updateTicker = 0
  fullNoteList: Note[] = []

  // For global search
  globalSearchTerm!: '';
  // Will be set to true when the global search modal is opened
  isGlobalSearchOpen!: false;
  // For search results presentation
  searchResults = {
    notes: [],
    resources: [],
    settings: []
  };

  offlineNoteStorage = new StorageListState<OfflineNote>({ key: 'offlineNotes' });
  offlinePendingOps = new StorageListState<OfflinePendingOp>({ key: 'offlinePendingOps' });

  get offlineNotes(): OfflineNote[] {
    return this.offlineNoteStorage.list;
  }

  get isOnline(): boolean {
    return RootStore.Get(BaseStore).isOnline;
  }

  private saveOfflineNote(note: OfflineNote) {
    this.offlineNoteStorage.push(note);
  }

  private removeOfflineNote(id: number) {
    const index = this.offlineNoteStorage.list?.findIndex(note => note.id === id);
    if (index !== -1) {
      this.offlineNoteStorage.remove(index);
    }
  }

  private async getFilteredNotes(params: {
    page: number;
    size: number;
    filterConfig: any;
    offlineFilter?: (note: OfflineNote) => boolean | undefined;
  }) {
    const { page, size, filterConfig, offlineFilter = () => true } = params;
    let notes: Note[] = [];

    const mergedFilter = {
      ...this.noteListFilterConfig,
      ...filterConfig,
      searchText: this.searchText,
      page,
      size,
    };

    if (this.isOnline) {
      notes = await api.notes.list.mutate(mergedFilter);
      // fire-and-forget: populate cache for offline use
      upsertNotesToCache(notes).catch(e => console.error('[cache] write failed:', e));
      if (this.offlineNotes.length > 0) {
        await this.syncOfflineNotes();
      }
    } else {
      notes = await queryNotesFromCache(mergedFilter);
    }

    const filteredOfflineNotes = this.offlineNotes.filter(offlineFilter);
    // Dexie already paginates when offline; online list is paginated by the server
    return [...filteredOfflineNotes, ...notes].map(i => ({ ...i, isExpand: false }));
  }

  /**
   * Generic note query for the Direction D screens (stream / todo lanes /
   * matrix / calendar). Goes through getFilteredNotes so it inherits the
   * online→cache fallback and offline-note merge. The offlineFilter mirrors the
   * common boolean filters so unsynced offline notes still surface in the right
   * view. Pass task filters (isCompleted, dueStart/dueEnd, quadrant, isImportant,
   * isUrgent, type) directly in filterConfig.
   */
  queryNotes = async (filterConfig: Record<string, any> = {}, page = 1, size = 100): Promise<Note[]> => {
    const fc: Record<string, any> = { isArchived: false, isRecycle: false, type: -1, ...filterConfig };
    return this.getFilteredNotes({
      page,
      size,
      filterConfig: fc,
      offlineFilter: (n: OfflineNote) => {
        if (fc.isRecycle != null && !!n.isRecycle !== !!fc.isRecycle) return false;
        if (fc.isArchived != null && !!n.isArchived !== !!fc.isArchived) return false;
        if (fc.type != null && fc.type !== -1 && n.type !== fc.type) return false;
        if (fc.isCompleted != null && (n.completedAt != null) !== !!fc.isCompleted) return false;
        if (fc.isImportant != null && !!n.isImportant !== !!fc.isImportant) return false;
        if (fc.isUrgent != null && !!n.isUrgent !== !!fc.isUrgent) return false;
        return true;
      },
    });
  }

  upsertNote = new PromiseState({
    eventKey: 'upsertNote',
    function: async (params: UpsertNoteParams) => {
      console.log("upsertNote", params)
      const {
        content = null,
        isArchived,
        isRecycle,
        type,
        id,
        attachments = [],
        refresh = true,
        isTop,
        isShare,
        showToast = true,
        references = [],
        createdAt: inputCreatedAt,
        updatedAt: inputUpdatedAt,
        metadata,
        dueDate,
        isImportant,
        isUrgent,
        completedAt
      } = params;

      const saveOffline = (reason: 'offline' | 'fallback') => {
        if (!id) {
          const now = new Date();
          const offlineNote: OfflineNote = {
            id: now.getTime(),
            content: content || '',
            type,
            isArchived: !!isArchived,
            isRecycle: !!isRecycle,
            attachments: attachments || [],
            isTop: !!isTop,
            isShare: !!isShare,
            references: references.map(refId => ({ toNoteId: refId })),
            createdAt: now,
            updatedAt: now,
            isOffline: true,
            pendingSync: true,
            tags: [],
            metadata: metadata || {},
            dueDate: dueDate === undefined || dueDate === null ? null : new Date(dueDate),
            isImportant: !!isImportant,
            isUrgent: !!isUrgent,
            completedAt: completedAt === undefined || completedAt === null ? null : new Date(completedAt)
          };
          this.saveOfflineNote(offlineNote);
          if (showToast) {
            const toast = RootStore.Get(ToastPlugin);
            const msg = i18n.t("create-successfully") + ' - ' + i18n.t("offline-status");
            reason === 'fallback' ? toast.warning(msg) : toast.success(msg);
          }
          refresh && this.updateTicker++;
          return offlineNote;
        } else {
          this.offlinePendingOps.push({ type: 'edit', noteId: id, patch: params });
          patchNoteInCache(id, params).catch(e => console.error('[cache] patch failed:', e));
          showToast && RootStore.Get(ToastPlugin).warning(i18n.t("offline-status"));
          refresh && this.updateTicker++;
          return;
        }
      };

      if (!this.isOnline) {
        return saveOffline('offline');
      }

      // navigator.onLine can lie on iOS WKWebView. Race the upsert against a short
      // timeout so we fail fast and fall back to the offline queue instead of hanging
      // for the full 5-minute trpc timeout.
      try {
        const res = await Promise.race([
          api.notes.upsert.mutate({
            content,
            type,
            isArchived,
            isRecycle,
            id,
            attachments,
            isTop,
            isShare,
            references,
            createdAt: inputCreatedAt ? new Date(inputCreatedAt) : undefined,
            updatedAt: inputUpdatedAt ? new Date(inputUpdatedAt) : undefined,
            metadata,
            dueDate: dueDate === undefined ? undefined : (dueDate === null ? null : new Date(dueDate)),
            isImportant,
            isUrgent,
            completedAt: completedAt === undefined ? undefined : (completedAt === null ? null : new Date(completedAt))
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('upsert-timeout')), 15000)
          )
        ]);
        eventBus.emit('editor:clear')
        showToast && RootStore.Get(ToastPlugin).success(id ? i18n.t("update-successfully") : i18n.t("create-successfully"))
        refresh && this.updateTicker++
        return res
      } catch (error) {
        const msg = (error as Error)?.message ?? '';
        const looksLikeNetworkFailure =
          msg === 'upsert-timeout' ||
          msg.includes('Load failed') ||
          msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('aborted');
        if (looksLikeNetworkFailure) {
          console.warn('[upsertNote] online save failed, falling back to offline:', msg);
          RootStore.Get(BaseStore).setOnlineStatus(false);
          return saveOffline('fallback');
        }
        throw error;
      }
    }
  })

  shareNote = new PromiseState({
    function: async (params: { id: number, isCancel: boolean, password?: string, expireAt?: Date }) => {
      const res = await api.notes.shareNote.mutate(params)
      RootStore.Get(ToastPlugin).success(i18n.t("operation-success"))
      this.updateTicker++
      return res
    }
  })

  trashNote = new PromiseState({
    function: async (params: { ids: number[] }) => {
      const { ids } = params;
      if (!this.isOnline) {
        for (const id of ids) {
          this.offlinePendingOps.push({ type: 'edit', noteId: id, patch: { isRecycle: true } });
          patchNoteInCache(id, { isRecycle: true }).catch(e => console.error('[cache] trash patch failed:', e));
        }
        RootStore.Get(ToastPlugin).warning(i18n.t("offline-status"));
        this.updateTicker++;
        return;
      }
      const res = await api.notes.trashMany.mutate({ ids });
      this.updateTicker++;
      return res;
    }
  })

  deleteNote = new PromiseState({
    function: async (params: { ids: number[] }) => {
      const { ids } = params;
      if (!this.isOnline) {
        for (const id of ids) {
          this.offlinePendingOps.push({ type: 'delete', noteId: id });
          deleteNoteFromCache(id).catch(e => console.error('[cache] delete failed:', e));
        }
        RootStore.Get(ToastPlugin).warning(i18n.t("offline-status"));
        this.updateTicker++;
        return;
      }
      const res = await api.notes.deleteMany.mutate({ ids });
      ids.forEach(id => {
        api.ai.embeddingDelete.mutate({ id }).catch(e => console.error('[embedding] delete failed:', e));
      });
      this.updateTicker++;
      return res;
    }
  })

  /**
   * Toggle a memo's task completion. Optimistically patches the cache so the UI
   * updates instantly, then routes through upsertNote (which handles offline
   * queueing + online save + reconnect replay) by setting completedAt.
   */
  toggleTaskDone = new PromiseState({
    function: async (params: { id: number; done: boolean; refresh?: boolean }) => {
      const completedAt = params.done ? new Date() : null;
      patchNoteInCache(params.id, { completedAt }).catch(e => console.error('[cache] toggleDone patch failed:', e));
      return await this.upsertNote.call({ id: params.id, completedAt, showToast: false, refresh: params.refresh ?? true });
    }
  })

  /** Set a task's due date (null clears it). Optimistic + offline-safe. */
  setTaskDue = new PromiseState({
    function: async (params: { id: number; dueDate: Date | null; refresh?: boolean }) => {
      patchNoteInCache(params.id, { dueDate: params.dueDate }).catch(e => console.error('[cache] setDue patch failed:', e));
      return await this.upsertNote.call({ id: params.id, dueDate: params.dueDate, showToast: false, refresh: params.refresh ?? true });
    }
  })

  /** Set a task's importance/urgency. Optimistic + offline-safe. */
  setTaskPriority = new PromiseState({
    function: async (params: { id: number; isImportant?: boolean; isUrgent?: boolean; refresh?: boolean }) => {
      const patch: Partial<Note> = {};
      if (params.isImportant !== undefined) patch.isImportant = params.isImportant;
      if (params.isUrgent !== undefined) patch.isUrgent = params.isUrgent;
      patchNoteInCache(params.id, patch).catch(e => console.error('[cache] setPriority patch failed:', e));
      return await this.upsertNote.call({ id: params.id, isImportant: params.isImportant, isUrgent: params.isUrgent, showToast: false, refresh: params.refresh ?? true });
    }
  })

  internalShareNote = new PromiseState({
    function: async (params: { id: number, accountIds: number[], isCancel: boolean }) => {
      const res = await api.notes.internalShareNote.mutate(params)
      RootStore.Get(ToastPlugin).success(i18n.t("operation-success"))
      this.updateTicker++
      return res
    }
  })

  getInternalSharedUsers = new PromiseState({
    function: async (id: number) => {
      return await api.notes.getInternalSharedUsers.mutate({ id })
    }
  })

  async syncOfflineNotes() {
    if (!this.isOnline) return;

    const offlineNotes = [...this.offlineNotes];
    for (const note of offlineNotes) {
      if (note.pendingSync) {
        try {
          const { id, isOffline, pendingSync, references, ...noteData } = note;
          const onlineNote: UpsertNoteParams = {
            ...noteData,
            references: references.map(ref => ref.toNoteId),
            showToast: false
          };
          await this.upsertNote.call(onlineNote);
          this.removeOfflineNote(id);
        } catch (error) {
          console.error('[offline-sync] failed for create:', error);
        }
      }
    }

    const ops = [...(this.offlinePendingOps.list ?? [])];
    for (const op of ops) {
      try {
        if (op.type === 'edit') {
          await api.notes.upsert.mutate({ id: op.noteId, ...op.patch });
        } else if (op.type === 'delete') {
          await api.notes.deleteMany.mutate({ ids: [op.noteId] });
          await deleteNoteFromCache(op.noteId);
        }
        const idx = this.offlinePendingOps.list?.indexOf(op) ?? -1;
        if (idx !== -1) this.offlinePendingOps.remove(idx);
      } catch (error) {
        console.error('[offline-sync] failed for op:', op, error);
        break;
      }
    }

    this.updateTicker++;
  }

  blinkoList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.BLINKO,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.BLINKO && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  noteOnlyList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.NOTE,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.NOTE && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  todoList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.TODO,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.TODO && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  archivedList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isArchived: true,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  trashList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isRecycle: true
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.isRecycle);
        }
      });
    }
  })

  noteList = new PromisePageState({
    function: async ({ page, size, ...filterConfig }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isArchived: false,
          ...filterConfig
        },
        offlineFilter: (note) => {
          // Exclude notes in recycle bin
          return !note.isRecycle;
        }
      });
    }
  })

  referenceSearchList = new PromisePageState({
    function: async ({ page, size, searchText }) => {
      return await api.notes.list.mutate({
        searchText
      })
    }
  })

  userList = new PromiseState({
    function: async () => {
      return await api.users.list.query()
    }
  })

  noteDetail = new PromiseState({
    function: async ({ id }) => {
      return await api.notes.detail.mutate({ id })
    }
  })

  dailyReviewNoteList = new PromiseState({
    function: async () => {
      return await api.notes.dailyReviewNoteList.query()
    }
  })

  randomReviewNoteList = new PromiseState({
    function: async ({ limit = 30 }) => {
      return await api.notes.randomNoteList.query({ limit })
    }
  })

  resourceList = new PromisePageState({
    function: async ({ page, size, searchText, folder }) => {
      return await api.attachments.list.query({ page, size, searchText, folder })
    }
  })

  tagList = new PromiseState({
    function: async () => {
      const falttenTags = await api.tags.list.query(undefined, { context: { skipBatch: true } });
      const listTags = helper.buildHashTagTreeFromDb(falttenTags)
      console.log(falttenTags, 'listTags')
      let pathTags: string[] = [];
      listTags.forEach(node => {
        pathTags = pathTags.concat(helper.generateTagPaths(node));
      });
      return { falttenTags, listTags, pathTags }
    }
  })

  get showAi() {
    return true
  }

  config = new PromiseState({
    loadingLock: false,
    function: async () => {
      const res = await api.config.list.query()
      return res
    }
  })

  task = new PromiseState({
    function: async () => {
      try {
        if (RootStore.Get(UserStore).role == 'superadmin') {
          return (await api.task.list.query()) ?? [];
        }
        return []
      } catch (error) {
        return []
      }
    }
  })

  updateDBTask = new PromiseState({
    function: async (isStart) => {
      if (isStart) {
        await api.task.upsertTask.mutate({ type: 'start', task: DBBAK_TASK_NAME })
      } else {
        await api.task.upsertTask.mutate({ type: 'stop', task: DBBAK_TASK_NAME })
      }
      await this.task.call()
    }
  })
  updateArchiveTask = new PromiseState({
    function: async (isStart) => {
      if (isStart) {
        await api.task.upsertTask.mutate({ type: 'start', task: ARCHIVE_BLINKO_TASK_NAME })
      } else {
        await api.task.upsertTask.mutate({ type: 'stop', task: ARCHIVE_BLINKO_TASK_NAME })
      }
      await this.task.call()
    }
  })


  get DBTask() {
    return this.task.value?.find(i => i.name == DBBAK_TASK_NAME)
  }

  get ArchiveTask() {
    return this.task.value?.find(i => i.name == ARCHIVE_BLINKO_TASK_NAME)
  }


  async onBottom() {
    const currentPath = new URLSearchParams(window.location.search).get('path');
    
    if (currentPath === 'notes') {
      await this.noteOnlyList.callNextPage({});
    } else if (currentPath === 'todo') {
      await this.todoList.callNextPage({});
    } else if (currentPath === 'archived') {
      await this.archivedList.callNextPage({});
    } else if (currentPath === 'trash') {
      await this.trashList.callNextPage({});
    } else if (currentPath === 'all') {
      this.noteList.resetAndCall({});
    } else {
      await this.blinkoList.callNextPage({});
    }
  }

  onMultiSelectNote(id: number) {
    if (this.curMultiSelectIds.includes(id)) {
      this.curMultiSelectIds = this.curMultiSelectIds.filter(item => item !== id);
    } else {
      this.curMultiSelectIds.push(id);
    }
    if (this.curMultiSelectIds.length == 0) {
      this.isMultiSelectMode = false
    }
  }

  onMultiSelectRest() {
    this.isMultiSelectMode = false
    this.curMultiSelectIds = []
    // Fix: Remove updateTicker++ to avoid unnecessary list refresh and duplicate display
    // this.updateTicker++
  }

  firstLoad() {
    this.tagList.call()
    this.config.call()
    this.dailyReviewNoteList.call()
    this.task.call()
  }


  async refreshData() {
    // Fix: Clear multi-select state when refreshing data to avoid stale selections
    this.curMultiSelectIds = [];
    this.isMultiSelectMode = false;

    this.tagList.call()

    const currentPath = new URLSearchParams(window.location.search).get('path');
    
    if (currentPath === 'notes') {
      this.noteOnlyList.resetAndCall({});
    } else if (currentPath === 'todo') {
      this.todoList.resetAndCall({});
    } else if (currentPath === 'archived') {
      this.archivedList.resetAndCall({});
    } else if (currentPath === 'trash') {
      this.trashList.resetAndCall({});
    } else if (currentPath === 'all') {
      this.noteList.resetAndCall({});
    } else {
      this.blinkoList.resetAndCall({});
    }
    
    this.config.call()
    this.dailyReviewNoteList.call()
  }

  private clear() {
    this.createContentStorage.clear()
    this.editContentStorage.clear()
  }

  use() {
    useEffect(() => {
      if (RootStore.Get(UserStore).id) {
        console.log('firstLoad', RootStore.Get(UserStore).id)
        this.firstLoad()
      }
    }, [RootStore.Get(UserStore).id])

    useEffect(() => {
      if (this.updateTicker == 0) return
      console.log('updateTicker', this.updateTicker)
      this.refreshData()
    }, [this.updateTicker])
  }

  useQuery() {
    const [searchParams] = useSearchParams();
    const location = useLocation();
    useEffect(() => {
      const tagId = searchParams.get('tagId');
      if (tagId && Number(tagId) === this.noteListFilterConfig.tagId) {
        return;
      }
      
      const withoutTag = searchParams.get('withoutTag');
      const withFile = searchParams.get('withFile');
      const withLink = searchParams.get('withLink');
      const searchText = searchParams.get('searchText') || this.searchText;
      const hasTodo = searchParams.get('hasTodo');
      const path = searchParams.get('path');

      this.noteListFilterConfig.type = NoteType.BLINKO
      this.noteTypeDefault = NoteType.BLINKO
      this.noteListFilterConfig.tagId = null
      this.noteListFilterConfig.isArchived = false
      this.noteListFilterConfig.withoutTag = false
      this.noteListFilterConfig.withLink = false
      this.noteListFilterConfig.withFile = false
      this.noteListFilterConfig.isRecycle = false
      this.noteListFilterConfig.startDate = null
      this.noteListFilterConfig.endDate = null
      this.noteListFilterConfig.isShare = null
      this.noteListFilterConfig.hasTodo = false

      // Fix: Clear multi-select state when switching paths to avoid stale selections
      this.curMultiSelectIds = [];
      this.isMultiSelectMode = false;

      if (path == 'notes') {
        this.noteListFilterConfig.type = NoteType.NOTE
        this.noteOnlyList.resetAndCall({});
      } else if (path == 'todo') {
        this.noteListFilterConfig.type = NoteType.TODO
        this.todoList.resetAndCall({});
      } else if (path == 'all') {
        this.noteListFilterConfig.type = -1
        this.noteList.resetAndCall({});
      } else if (path == 'archived') {
        this.noteListFilterConfig.type = -1
        this.noteListFilterConfig.isArchived = true
        this.archivedList.resetAndCall({});
      } else if (path == 'trash') {
        this.noteListFilterConfig.type = -1
        this.noteListFilterConfig.isRecycle = true
        this.trashList.resetAndCall({});
      } else {
        this.blinkoList.resetAndCall({});
      }

      if (tagId) {
        this.noteListFilterConfig.tagId = Number(tagId) as number
      }
      if (withoutTag) {
        this.noteListFilterConfig.withoutTag = true
      }
      if (withLink) {
        this.noteListFilterConfig.withLink = true
      }
      if (withFile) {
        this.noteListFilterConfig.withFile = true
      }
      if (hasTodo) {
        this.noteListFilterConfig.hasTodo = true
      }
      if (searchText) {
        this.searchText = searchText as string;
      } else {
        this.searchText = '';
      }
    }, [this.forceQuery, location.pathname, searchParams])
  }

  excludeEmbeddingTagId: number | null = null;

  setExcludeEmbeddingTagId(tagId: number | null) {
    this.excludeEmbeddingTagId = tagId;
  }

  settingsSearchText: string = '';
  constructor() {
    makeAutoObservable(this)
    eventBus.on('user:signout', () => {
      this.clear()
    })
    eventBus.on('app:online', () => {
      this.syncOfflineNotes()
    })
  }

  removeCreateAttachments(file: { name: string, }) {
    this.createAttachmentsStorage.removeByFind(f => f.name === file.name);
    this.updateTicker++;
  }

  updateTagFilter(tagId: number) {
    this.noteListFilterConfig.tagId = tagId;
    this.noteListFilterConfig.type = -1
    this.noteList.resetAndCall({});
  }
}
