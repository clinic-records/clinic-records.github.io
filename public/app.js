/**
 * Clinic Patient Records System - Modular Application Entry Point
 * Bootstraps all ES modules with native modularity and clean architectural boundaries.
 */

import { state } from './js/state.js';
import { api } from './js/api.js';
import { showToast, formatBytes, formatDate } from './js/utils.js';
import { openModal, closeModal, attemptCloseModal, initModalListeners } from './js/modules/modal.js';
import { initCropper } from './js/modules/cropper.js';
import { initRealtimeEvents, dismissConflictBanner } from './js/modules/realtime.js';
import { initTable, renderPatientsTable, updateBatchToolbar } from './js/modules/table.js';
import { initPatientForm, openAddPatientModal, openEditPatientModal } from './js/modules/patient-form.js';
import {
  initPatientDetails,
  openPatientDetails,
  checkUrlForPatient,
  triggerUploadPdf,
  deletePdf,
  viewPdf,
} from './js/modules/patient-details.js';
import { initVideos, playVideo, deleteVideo } from './js/modules/videos.js';
import { initBackups } from './js/modules/backups.js';
import { initUpdater, checkForAppUpdates } from './js/modules/updater.js';
import { initFilters } from './js/modules/filters.js';

function initClinicApp() {
  // DOM Elements Reference Cache
  const elements = {
    // Network and Presence
    navLanIp: document.getElementById('nav-lan-ip'),
    btnNetworkInfo: document.getElementById('btn-network-info'),
    modalNetwork: document.getElementById('modal-network'),
    networkQrImage: document.getElementById('network-qr-image'),
    networkLanUrl: document.getElementById('network-lan-url'),
    btnCopyLanUrl: document.getElementById('btn-copy-lan-url'),
    onlineUsersBadge: document.getElementById('online-users-badge'),
    onlineUsersCount: document.getElementById('online-users-count'),
    statNetworkQrThumb: document.getElementById('stat-network-qr-thumb'),

    // Statistics
    statPatientsCount: document.getElementById('stat-patients-count'),
    statPatientsTodayCount: document.getElementById('stat-patients-today-count'),
    statDocumentsCount: document.getElementById('stat-documents-count'),
    statVideosCount: document.getElementById('stat-videos-count'),
    statStorageSize: document.getElementById('stat-storage-size'),
    statRowRecycle: document.getElementById('stat-row-recycle'),
    statRecycleCount: document.getElementById('stat-recycle-count'),

    // Search and Advanced Filters
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    btnToggleFilters: document.getElementById('btn-toggle-filters'),
    activeFiltersCountBadge: document.getElementById('active-filters-count-badge'),
    advancedFiltersPanel: document.getElementById('advanced-filters-panel'),
    datePresetButtons: document.getElementById('date-preset-buttons'),
    customDateInputs: document.getElementById('custom-date-inputs'),
    filterDateFrom: document.getElementById('filter-date-from'),
    filterDateTo: document.getElementById('filter-date-to'),
    filterHasFiles: document.getElementById('filter-has-files'),
    filterSortBy: document.getElementById('filter-sort-by'),
    btnResetFilters: document.getElementById('btn-reset-filters'),

    // Table filter tabs
    tableTabsNav: document.getElementById('table-tabs-nav'),
    tabAllBadge: document.getElementById('tab-all-badge'),
    tabMaleBadge: document.getElementById('tab-male-badge'),
    tabFemaleBadge: document.getElementById('tab-female-badge'),
    tabRecycleBadge: document.getElementById('tab-recycle-badge'),
    btnEmptyRecycleTab: document.getElementById('btn-empty-recycle-tab'),

    // Patients table
    tableActiveTitle: document.getElementById('table-active-title'),
    patientsTableElement: document.getElementById('patients-table-element'),
    patientsTableBody: document.getElementById('patients-table-body'),
    thColDiag: document.getElementById('th-col-diag'),
    thColDate: document.getElementById('th-col-date'),
    thColActions: document.getElementById('th-col-actions'),
    resultsCountBadge: document.getElementById('results-count-badge'),
    emptyState: document.getElementById('empty-state'),
    btnEmptyAddPatient: document.getElementById('btn-empty-add-patient'),
    paginationSection: document.getElementById('pagination-section'),
    paginationInfoText: document.getElementById('pagination-info-text'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),

    // Batch actions & selection
    selectAllCheckbox: document.getElementById('select-all-checkbox'),
    batchActionsBar: document.getElementById('batch-actions-bar'),
    batchSelectedCount: document.getElementById('batch-selected-count'),
    btnBatchDelete: document.getElementById('btn-batch-delete'),
    btnTabRecycleRestore: document.getElementById('btn-tab-recycle-restore'),
    btnTabRecyclePermanent: document.getElementById('btn-tab-recycle-permanent'),
    btnBatchCancel: document.getElementById('btn-batch-cancel'),

    // Top action buttons
    btnAddPatient: document.getElementById('btn-add-patient'),
    btnBackup: document.getElementById('btn-backup'),

    // Patient Modals
    modalPatient: document.getElementById('modal-patient'),
    formPatient: document.getElementById('form-patient'),
    modalPatientDetails: document.getElementById('modal-patient-details'),

    // Backup manager modal
    modalBackupManager: document.getElementById('modal-backup-manager'),
    btnCreateBackupNow: document.getElementById('btn-create-backup-now'),
    inputUploadBackup: document.getElementById('input-upload-backup'),
    backupListContainer: document.getElementById('backup-list-container'),

    // App Update Elements
    modalAppUpdate: document.getElementById('modal-app-update'),
    updateCurrentVersionLabel: document.getElementById('update-current-version-label'),
    updateLatestVersionLabel: document.getElementById('update-latest-version-label'),
    updateNotesContent: document.getElementById('update-notes-content'),
    updateProgressContainer: document.getElementById('update-progress-container'),
    updateProgressStatusText: document.getElementById('update-progress-status-text'),
    updateProgressPercentText: document.getElementById('update-progress-percent-text'),
    updateProgressFill: document.getElementById('update-progress-fill'),
    btnUpdateStart: document.getElementById('btn-update-start'),
    btnUpdateViewGithub: document.getElementById('btn-update-view-github'),
    btnUpdateCancel: document.getElementById('btn-update-cancel'),
  };

  /* ==========================================================================
     Global Keyboard Shortcuts
     ========================================================================== */
  document.addEventListener('keydown', (e) => {
    // 1. Search focus: Ctrl + F / Cmd + F or /
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key === 'ب')) {
      e.preventDefault();
      elements.searchInput?.focus();
      elements.searchInput?.select();
      return;
    }
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      elements.searchInput?.focus();
      return;
    }

    // 2. Add new patient: Alt + N / Option + N or F2
    if ((e.altKey && (e.key.toLowerCase() === 'n' || e.key === 'ى')) || e.key === 'F2') {
      e.preventDefault();
      openAddPatientModal();
      return;
    }

    // 3. Save patient form: Ctrl + S / Cmd + S when modal is open
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.key === 'س')) {
      if (elements.modalPatient && !elements.modalPatient.classList.contains('hidden')) {
        e.preventDefault();
        elements.formPatient?.requestSubmit();
        return;
      }
    }

    // 4. Escape: Safely close topmost visible modal
    if (e.key === 'Escape') {
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'));
      if (openModals.length > 0) {
        const topModal = openModals[openModals.length - 1];
        attemptCloseModal(topModal, () => state.isEditFormDirty);
      }
    }
  });

  /* ==========================================================================
     Network & LAN Info
     ========================================================================== */
  async function loadNetworkInfo() {
    try {
      const data = await api.getNetworkInfo();
      state.networkInfo = data;

      if (elements.navLanIp && data.lanUrl) {
        elements.navLanIp.textContent = data.lanUrl.replace('http://', '');
      }
      if (elements.networkLanUrl) {
        elements.networkLanUrl.textContent = data.lanUrl;
      }
      if (data.qrCodeDataUrl) {
        if (elements.networkQrImage) elements.networkQrImage.src = data.qrCodeDataUrl;
        if (elements.statNetworkQrThumb) elements.statNetworkQrThumb.src = data.qrCodeDataUrl;
      }
    } catch (err) {
      console.warn('Failed to load network info:', err);
    }
  }

  elements.btnNetworkInfo?.addEventListener('click', () => {
    openModal(elements.modalNetwork);
  });

  elements.btnCopyLanUrl?.addEventListener('click', () => {
    if (state.networkInfo?.lanUrl) {
      navigator.clipboard.writeText(state.networkInfo.lanUrl).then(() => {
        showToast('تم نسخ رابط البرنامج بنجاح');
      });
    }
  });

  /* ==========================================================================
     Statistics
     ========================================================================== */
  async function loadStats() {
    try {
      const stats = await api.getStats();

      if (elements.statPatientsCount) elements.statPatientsCount.textContent = Number(stats.totalPatients).toLocaleString('ar-EG');
      if (elements.statPatientsTodayCount) elements.statPatientsTodayCount.textContent = Number(stats.todayPatients || 0).toLocaleString('ar-EG');
      if (elements.statDocumentsCount) elements.statDocumentsCount.textContent = Number(stats.totalDocuments).toLocaleString('ar-EG');
      if (elements.statVideosCount) elements.statVideosCount.textContent = Number(stats.totalVideos).toLocaleString('ar-EG');
      if (elements.statStorageSize) elements.statStorageSize.textContent = formatBytes(stats.totalStorageBytes);

      const rCount = Number(stats.recycleBinCount || 0);
      if (elements.statRecycleCount) elements.statRecycleCount.textContent = rCount.toLocaleString('ar-EG');
      if (elements.tabAllBadge) elements.tabAllBadge.textContent = Number(stats.totalPatients || 0).toLocaleString('ar-EG');
      if (elements.tabMaleBadge) elements.tabMaleBadge.textContent = Number(stats.malePatients || 0).toLocaleString('ar-EG');
      if (elements.tabFemaleBadge) elements.tabFemaleBadge.textContent = Number(stats.femalePatients || 0).toLocaleString('ar-EG');
      if (elements.tabRecycleBadge) {
        elements.tabRecycleBadge.textContent = rCount.toLocaleString('ar-EG');
        elements.tabRecycleBadge.classList.toggle('hidden', rCount === 0);
      }
      if (elements.btnEmptyRecycleTab) {
        elements.btnEmptyRecycleTab.classList.toggle('hidden', state.activeTab !== 'recycle' || rCount === 0);
      }
    } catch (err) {
      console.warn('Failed to load statistics:', err);
    }
  }

  /* ==========================================================================
     Patients List Loader
     ========================================================================== */
  async function loadPatients(silent = false) {
    try {
      const params = {
        page: state.currentPage,
        limit: state.limit,
      };

      if (state.searchQuery) params.q = state.searchQuery;
      if (state.genderFilter) params.gender = state.genderFilter;
      if (state.startDate) params.startDate = state.startDate;
      if (state.endDate) params.endDate = state.endDate;
      if (state.hasFilesFilter && state.hasFilesFilter !== 'all') params.hasFiles = state.hasFilesFilter;
      if (state.sortBy && state.sortBy !== 'created_desc') params.sortBy = state.sortBy;

      let data;
      if (state.activeTab === 'recycle') {
        const q = new URLSearchParams(params).toString();
        const res = await fetch(`/api/recycle-bin?${q}`);
        if (!res.ok) throw new Error('Failed to fetch recycle bin');
        data = await res.json();
      } else {
        data = await api.getPatients(params);
      }

      state.patients = data.patients || [];
      state.totalPatients = data.total || 0;
      state.totalPages = data.totalPages || 1;

      renderPatientsTable();
    } catch (err) {
      if (!silent) {
        console.error(err);
        showToast('خطأ أثناء تحميل بيانات المرضى', 'danger');
      }
    }
  }

  /* ==========================================================================
     Table Tabs & Advanced Filters (Modular)
     ========================================================================== */
  initFilters(elements, {
    onFiltersChanged: () => loadPatients(),
  });

  // Pagination controls
  elements.btnPrevPage?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      loadPatients();
    }
  });

  elements.btnNextPage?.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      loadPatients();
    }
  });

  // Top action button: Add patient
  elements.btnAddPatient?.addEventListener('click', () => {
    openAddPatientModal();
  });
  elements.btnEmptyAddPatient?.addEventListener('click', () => {
    openAddPatientModal();
  });

  // Batch Selection Cancel
  elements.btnBatchCancel?.addEventListener('click', () => {
    state.selectedPatientIds.clear();
    updateBatchToolbar();
  });

  // Batch move to recycle bin
  elements.btnBatchDelete?.addEventListener('click', async () => {
    const count = state.selectedPatientIds.size;
    if (count === 0) return;

    const ok = confirm(`هل أنت متأكد من نقل ${count} مريض محدد إلى سلة المحذوفات؟`);
    if (!ok) return;

    try {
      const ids = Array.from(state.selectedPatientIds);
      const res = await fetch('/api/patients/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل نقل المرضى إلى سلة المحذوفات');
      }

      showToast(`تم نقل ${count} مريض إلى سلة المحذوفات`);
      state.selectedPatientIds.clear();
      updateBatchToolbar();
      loadPatients();
      loadStats();
    } catch (err) {
      showToast(err.message || 'خطأ أثناء نقل المرضى المحددين', 'danger');
    }
  });

  // Batch restore in recycle tab
  elements.btnTabRecycleRestore?.addEventListener('click', async () => {
    const count = state.selectedPatientIds.size;
    if (count === 0) return;
    try {
      const ids = Array.from(state.selectedPatientIds);
      const res = await fetch('/api/recycle-bin/batch-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error();
      showToast(`تمت استعادة ${count} مريض بنجاح`);
      state.selectedPatientIds.clear();
      loadPatients();
      loadStats();
    } catch {
      showToast('خطأ أثناء استعادة المرضى المحددين', 'danger');
    }
  });

  // Batch permanent delete in recycle tab
  elements.btnTabRecyclePermanent?.addEventListener('click', async () => {
    const count = state.selectedPatientIds.size;
    if (count === 0) return;
    const ok = confirm(`تحذير: هل أنت متأكد من حذف ${count} مريض محدد نهائياً؟\nسيتم مسح وثائقهم وفيديوهاتهم من القرص ولا يمكن التراجع.`);
    if (!ok) return;
    try {
      const ids = Array.from(state.selectedPatientIds);
      const res = await fetch('/api/recycle-bin/batch-permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error();
      showToast(`تم حذف ${count} مريض نهائياً بنجاح`);
      state.selectedPatientIds.clear();
      loadPatients();
      loadStats();
    } catch {
      showToast('خطأ أثناء الحذف النهائي للمحددين', 'danger');
    }
  });

  // Empty recycle bin button on tab
  elements.btnEmptyRecycleTab?.addEventListener('click', async () => {
    const ok = confirm('تحذير شديد: هل أنت متأكد من إفراغ سلة المحذوفات بالكامل؟\nسيتم حذف جميع سجلات المرضى ومستنداتهم وفيديوهاتهم نهائياً ولا يمكن التراجع.');
    if (!ok) return;
    try {
      const res = await fetch('/api/recycle-bin/empty', { method: 'POST' });
      if (!res.ok) throw new Error();
      showToast('تم إفراغ سلة المحذوفات بالكامل');
      state.selectedPatientIds.clear();
      loadPatients();
      loadStats();
    } catch {
      showToast('خطأ أثناء إفراغ سلة المحذوفات', 'danger');
    }
  });

  /* ==========================================================================
     Global Handlers Exposure for Inline HTML Attributes
     ========================================================================== */
  window.clinicApp = {
    triggerUploadPdf,
    deletePdf,
    viewPdf,
    playVideo,
    deleteVideo,
    dismissConflictBanner,
    forceRefreshPatient: () => {
      dismissConflictBanner();
      state.isEditFormDirty = false;
      closeModal(elements.modalPatient);
      if (state.selectedPatientId) {
        openPatientDetails(state.selectedPatientId, false);
      }
    },
    checkForAppUpdates: () => checkForAppUpdates(elements),
  };

  /* ==========================================================================
     Modules Initializations
     ========================================================================== */
  initModalListeners(() => state.isEditFormDirty);

  initCropper({
    onFormCropped: (dataUrl) => {
      // Cropped avatar for add/edit form handled inside cropper module
    },
    onDetailCropped: async (blob) => {
      if (!state.selectedPatientId) return;
      try {
        showToast('جاري حفظ الصورة المقصوصة...');
        const formData = new FormData();
        formData.append('photo', blob, 'avatar.jpg');
        await api.uploadPhoto(state.selectedPatientId, formData);
        showToast('تم تحديث صورة المريض بنجاح', 'success');
        openPatientDetails(state.selectedPatientId, false);
        loadPatients(true);
      } catch (err) {
        showToast('فشل حفظ الصورة: ' + (err.message || 'خطأ'), 'danger');
      }
    },
  });

  initRealtimeEvents({
    onPatientsListChanged: () => {
      if (!state.isEditFormDirty) {
        loadPatients(true);
        loadStats();
      }
    },
    onPatientUpdated: (data) => {
      if (data.updatedBy === state.clientId) return;
      if (state.selectedPatientId && state.selectedPatientId === data.patientId) {
        if (!state.isEditFormDirty) {
          showToast('تم تعديل الملف من جهاز آخر، جاري التحديث...', 'warning');
          openPatientDetails(data.patientId, false);
        }
      }
    },
  });

  initTable({
    onPatientSelected: (id) => openPatientDetails(id),
    onRestorePatient: async (id) => {
      try {
        const res = await fetch(`/api/recycle-bin/${id}/restore`, { method: 'POST' });
        if (!res.ok) throw new Error();
        showToast('تمت استعادة ملف المريض بنجاح');
        state.selectedPatientIds.delete(id);
        loadPatients();
        loadStats();
      } catch {
        showToast('خطأ أثناء استعادة المريض', 'danger');
      }
    },
    onPermanentDelete: async (id) => {
      const ok = confirm('تحذير: هل أنت متأكد من حذف هذا المريض نهائياً؟\nسيتم مسح جميع وثائقه وفيديوهاته من القرص ولا يمكن التراجع.');
      if (!ok) return;
      try {
        const res = await fetch(`/api/recycle-bin/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        showToast('تم حذف المريض نهائياً بنجاح');
        state.selectedPatientIds.delete(id);
        loadPatients();
        loadStats();
      } catch {
        showToast('خطأ أثناء الحذف النهائي', 'danger');
      }
    },
  });

  initPatientForm({
    onPatientSaved: () => {
      loadPatients();
      loadStats();
    },
  });

  initPatientDetails({
    onPatientEditRequested: (id) => openEditPatientModal(id),
    onPatientRefreshRequested: () => {
      loadPatients(true);
      loadStats();
    },
  });

  initVideos({
    onVideoChanged: () => {
      if (state.selectedPatientId) {
        openPatientDetails(state.selectedPatientId, false);
      }
      loadStats();
    },
  });

  initBackups(elements, {
    onRestoreSuccess: () => {
      loadStats();
      loadPatients();
    },
  });

  initUpdater(elements);

  // Initial Data Loads
  loadNetworkInfo();
  loadStats();
  loadPatients();
  checkUrlForPatient();
  checkForAppUpdates(elements);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initClinicApp);
} else {
  initClinicApp();
}
