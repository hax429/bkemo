import type { SearchInput } from '../types';

export type SidebarFilterState = {
  query: string;
  selectedTag: string | null;
  tasksOnly: boolean;
  includeArchived: boolean;
  limit?: number;
};

/** Build the companion search payload from sidebar filter controls. */
export function buildSearchInput(state: SidebarFilterState): SearchInput {
  return {
    query: state.query.trim() || undefined,
    tag: state.selectedTag || undefined,
    tasksOnly: state.tasksOnly || undefined,
    archived: state.includeArchived ? 'include' : 'exclude',
    limit: state.limit ?? 50,
  };
}

export function filtersAreActive(state: SidebarFilterState): boolean {
  return !!(state.query.trim() || state.selectedTag || state.tasksOnly || state.includeArchived);
}
