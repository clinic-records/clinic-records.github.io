/**
 * Clinic Patient Records - Search, Tabs & Advanced Filters Module
 * Clean Enterprise Module for table filtering, tabs switching, and date presets.
 */

import { state } from '../state.js';

export function initFilters(elements, callbacks = {}) {
  const onFiltersChanged = callbacks.onFiltersChanged || (() => {});

  // 1. Switch active table tab (all, male, female, recycle)
  function switchTab(tab) {
    state.activeTab = tab;
    state.currentPage = 1;
    state.selectedPatientIds.clear();

    if (elements.tableTabsNav) {
      elements.tableTabsNav.querySelectorAll('.table-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
      });
    }

    if (tab === 'male') {
      state.genderFilter = 'male';
    } else if (tab === 'female') {
      state.genderFilter = 'female';
    } else {
      state.genderFilter = '';
    }

    onFiltersChanged();
  }

  elements.tableTabsNav?.addEventListener('click', (e) => {
    const btn = e.target.closest('.table-tab');
    if (!btn) return;
    const tab = btn.getAttribute('data-tab');
    switchTab(tab);
  });

  elements.statRowRecycle?.addEventListener('click', () => {
    switchTab('recycle');
    elements.patientsTableElement?.scrollIntoView({ behavior: 'smooth' });
  });

  // 2. Search input with responsive debounce
  let searchDebounceTimer = null;
  elements.searchInput?.addEventListener('input', () => {
    const val = elements.searchInput.value.trim();
    elements.searchClearBtn?.classList.toggle('hidden', val.length === 0);

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.searchQuery = val;
      state.currentPage = 1;
      onFiltersChanged();
    }, 200);
  });

  elements.searchClearBtn?.addEventListener('click', () => {
    if (elements.searchInput) elements.searchInput.value = '';
    elements.searchClearBtn.classList.add('hidden');
    state.searchQuery = '';
    state.currentPage = 1;
    updateActiveFiltersIndicator();
    onFiltersChanged();
  });

  // 3. Update filter indicator count badge
  function updateActiveFiltersIndicator() {
    let count = 0;
    if (state.datePreset !== 'all' || state.startDate || state.endDate) count++;
    if (state.hasFilesFilter !== 'all') count++;
    if (state.sortBy !== 'created_desc') count++;

    if (elements.activeFiltersCountBadge) {
      elements.activeFiltersCountBadge.textContent = count;
      elements.activeFiltersCountBadge.classList.toggle('hidden', count === 0);
    }
    if (elements.btnResetFilters) {
      elements.btnResetFilters.classList.toggle('hidden', count === 0 && !state.searchQuery);
    }
    if (elements.btnToggleFilters) {
      elements.btnToggleFilters.classList.toggle('active', count > 0);
    }
  }

  // 4. Advanced filters panel toggle
  elements.btnToggleFilters?.addEventListener('click', () => {
    elements.advancedFiltersPanel?.classList.toggle('hidden');
  });

  // 5. Date preset buttons (all, today, week, month, custom)
  elements.datePresetButtons?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date-preset]');
    if (!btn) return;

    const preset = btn.getAttribute('data-date-preset');
    state.datePreset = preset;

    elements.datePresetButtons.querySelectorAll('[data-date-preset]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });

    if (preset === 'custom') {
      elements.customDateInputs?.classList.remove('hidden');
      state.startDate = elements.filterDateFrom?.value || '';
      state.endDate = elements.filterDateTo?.value || '';
    } else {
      elements.customDateInputs?.classList.add('hidden');
      if (elements.filterDateFrom) elements.filterDateFrom.value = '';
      if (elements.filterDateTo) elements.filterDateTo.value = '';

      if (preset === 'all') {
        state.startDate = '';
        state.endDate = '';
      } else if (preset === 'today') {
        const today = new Date().toISOString().split('T')[0];
        state.startDate = today;
        state.endDate = today;
      } else if (preset === 'week') {
        const d = new Date();
        const end = d.toISOString().split('T')[0];
        d.setDate(d.getDate() - 7);
        const start = d.toISOString().split('T')[0];
        state.startDate = start;
        state.endDate = end;
      } else if (preset === 'month') {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        state.startDate = `${year}-${month}-01`;
        state.endDate = now.toISOString().split('T')[0];
      }
    }

    state.currentPage = 1;
    updateActiveFiltersIndicator();
    onFiltersChanged();
  });

  // 6. Custom date range inputs
  elements.filterDateFrom?.addEventListener('change', () => {
    state.startDate = elements.filterDateFrom.value;
    state.currentPage = 1;
    updateActiveFiltersIndicator();
    onFiltersChanged();
  });

  elements.filterDateTo?.addEventListener('change', () => {
    state.endDate = elements.filterDateTo.value;
    state.currentPage = 1;
    updateActiveFiltersIndicator();
    onFiltersChanged();
  });

  // 7. Medical documents filter
  elements.filterHasFiles?.addEventListener('change', () => {
    state.hasFilesFilter = elements.filterHasFiles.value;
    state.currentPage = 1;
    updateActiveFiltersIndicator();
    onFiltersChanged();
  });

  // 8. Sorting filter
  elements.filterSortBy?.addEventListener('change', () => {
    state.sortBy = elements.filterSortBy.value;
    state.currentPage = 1;
    updateActiveFiltersIndicator();
    onFiltersChanged();
  });

  // 9. Reset all filters
  function resetFilters() {
    state.datePreset = 'all';
    state.startDate = '';
    state.endDate = '';
    state.hasFilesFilter = 'all';
    state.sortBy = 'created_desc';
    state.searchQuery = '';
    state.currentPage = 1;

    if (elements.searchInput) {
      elements.searchInput.value = '';
      elements.searchClearBtn?.classList.add('hidden');
    }

    if (elements.datePresetButtons) {
      elements.datePresetButtons.querySelectorAll('[data-date-preset]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-date-preset') === 'all');
      });
    }

    elements.customDateInputs?.classList.add('hidden');
    if (elements.filterDateFrom) elements.filterDateFrom.value = '';
    if (elements.filterDateTo) elements.filterDateTo.value = '';
    if (elements.filterHasFiles) elements.filterHasFiles.value = 'all';
    if (elements.filterSortBy) elements.filterSortBy.value = 'created_desc';

    updateActiveFiltersIndicator();
    onFiltersChanged();
  }

  elements.btnResetFilters?.addEventListener('click', resetFilters);

  return {
    switchTab,
    resetFilters,
    updateActiveFiltersIndicator,
  };
}
