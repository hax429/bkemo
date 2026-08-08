import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchInput, filtersAreActive } from './searchFilters.js';

describe('searchFilters', () => {
  it('builds search input from sidebar filter controls', () => {
    assert.deepEqual(
      buildSearchInput({
        query: '  report  ',
        selectedTag: 'work',
        tasksOnly: true,
        includeArchived: false,
        limit: 25,
      }),
      {
        query: 'report',
        tag: 'work',
        tasksOnly: true,
        archived: 'exclude',
        limit: 25,
      },
    );
  });

  it('omits empty query/tag and marks archive include', () => {
    assert.deepEqual(
      buildSearchInput({
        query: '   ',
        selectedTag: null,
        tasksOnly: false,
        includeArchived: true,
      }),
      {
        query: undefined,
        tag: undefined,
        tasksOnly: undefined,
        archived: 'include',
        limit: 50,
      },
    );
  });

  it('detects active filters', () => {
    assert.equal(filtersAreActive({
      query: '',
      selectedTag: null,
      tasksOnly: false,
      includeArchived: false,
    }), false);
    assert.equal(filtersAreActive({
      query: '',
      selectedTag: 'inbox',
      tasksOnly: false,
      includeArchived: false,
    }), true);
  });
});
