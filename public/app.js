/**
 * Clinic Patient Records System - Frontend Controller
 * Includes real-time SSE presence, concurrent viewing detection, conflict warnings,
 * URL routing for direct sharing, and responsive table states.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Client identifier for presence and conflict tracking
  const clientId = sessionStorage.getItem('clinic_client_id') ||
    `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  sessionStorage.setItem('clinic_client_id', clientId);

  // Application State
  const state = {
    clientId,
    patients: [],
    selectedPatientIds: new Set(),
    totalPatients: 0,
    currentPage: 1,
    limit: 15,
    totalPages: 1,
    searchQuery: '',
    genderFilter: '',
    selectedPatientId: null,
    selectedPatientDetails: null,
    pendingDocUploadType: null,
    networkInfo: null,
    isEditFormDirty: false,
    sseSource: null,

    // Navigation and tab filtering
    activeTab: 'all',
    saveActionTarget: 'upload',

    // Advanced Filters State
    datePreset: 'all',
    startDate: '',
    endDate: '',
    hasFilesFilter: 'all',
    sortBy: 'created_desc',

    // Pending photo for create/edit form
    pendingPhotoBase64: null,
    removePhotoPending: false,
  };

  // DOM Elements
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

    // Add / Edit patient modal
    modalPatient: document.getElementById('modal-patient'),
    modalPatientTitle: document.getElementById('modal-patient-title'),
    formPatient: document.getElementById('form-patient'),
    patientFormId: document.getElementById('patient-form-id'),
    btnSavePatient: document.getElementById('btn-save-patient'),
    btnSavePatientOnly: document.getElementById('btn-save-patient-only'),
    btnSavePatientText: document.getElementById('btn-save-patient-text'),
    inputFullName: document.getElementById('input-full-name'),
    inputFileNumber: document.getElementById('input-file-number'),
    inputPhone: document.getElementById('input-phone'),
    inputNationalId: document.getElementById('input-national-id'),
    inputGender: document.getElementById('input-gender'),
    inputAge: document.getElementById('input-age'),
    inputBirthDate: document.getElementById('input-birth-date'),
    inputDiagnosis: document.getElementById('input-diagnosis'),
    inputNotes: document.getElementById('input-notes'),

    // Patient profile details modal
    modalPatientDetails: document.getElementById('modal-patient-details'),
    btnDetailsAddAnother: document.getElementById('btn-details-add-another'),
    detailFileNumber: document.getElementById('detail-file-number'),
    detailFullName: document.getElementById('detail-full-name'),
    detailViewersBadge: document.getElementById('detail-viewers-badge'),
    detailMetaRow: document.getElementById('detail-meta-row'),
    detailDiagnosis: document.getElementById('detail-diagnosis'),
    detailNotes: document.getElementById('detail-notes'),
    btnEditPatientDetails: document.getElementById('btn-edit-patient-details'),
    btnCopyPatientLink: document.getElementById('btn-copy-patient-link'),
    btnPatientQrThumb: document.getElementById('btn-patient-qr-thumb'),
    btnPrintPatient: document.getElementById('btn-print-patient'),
    patientConflictAlertContainer: document.getElementById('patient-conflict-alert-container'),

    // Patient share & QR modal
    modalSharePatient: document.getElementById('modal-share-patient'),
    sharePatientName: document.getElementById('share-patient-name'),
    sharePatientFileNumber: document.getElementById('share-patient-file-number'),
    sharePatientQrImage: document.getElementById('share-patient-qr-image'),
    sharePatientUrl: document.getElementById('share-patient-url'),
    btnCopyShareUrl: document.getElementById('btn-copy-share-url'),

    // Four PDF document containers
    bodyDocSeparate: document.getElementById('body-doc-separate'),
    bodyDocProgram: document.getElementById('body-doc-program'),
    bodyDocTests: document.getElementById('body-doc-tests'),
    bodyDocBehavioralPlan: document.getElementById('body-doc-behavioral_plan'),
    hiddenPdfInput: document.getElementById('hidden-pdf-input'),

    // Video section
    btnUploadVideoTrigger: document.getElementById('btn-upload-video-trigger'),
    inputVideoFile: document.getElementById('input-video-file'),
    videoUploadProgressContainer: document.getElementById('video-upload-progress-container'),
    videoUploadFilename: document.getElementById('video-upload-filename'),
    videoUploadPercentage: document.getElementById('video-upload-percentage'),
    videoUploadProgressBar: document.getElementById('video-upload-progress-bar'),
    videosGrid: document.getElementById('videos-grid'),

    // PDF viewer modal
    modalPdfViewer: document.getElementById('modal-pdf-viewer'),
    pdfViewerTitle: document.getElementById('pdf-viewer-title'),
    pdfIframe: document.getElementById('pdf-iframe'),
    btnPdfDownload: document.getElementById('btn-pdf-download'),

    // Video player modal
    modalVideoPlayer: document.getElementById('modal-video-player'),
    videoPlayerTitle: document.getElementById('video-player-title'),
    html5VideoPlayer: document.getElementById('html5-video-player'),

    // Backup manager modal
    modalBackupManager: document.getElementById('modal-backup-manager'),
    btnCreateBackupNow: document.getElementById('btn-create-backup-now'),
    inputUploadBackup: document.getElementById('input-upload-backup'),
    backupListContainer: document.getElementById('backup-list-container'),

    // Patient Avatar & Photo Elements
    detailAvatarWrap: document.getElementById('detail-avatar-wrap'),
    detailAvatarImg: document.getElementById('detail-avatar-img'),
    detailAvatarFallback: document.getElementById('detail-avatar-fallback'),
    btnChangeDetailPhoto: document.getElementById('btn-change-detail-photo'),
    inputDetailPhoto: document.getElementById('input-detail-photo'),
    formAvatarPreviewWrap: document.getElementById('form-avatar-preview-wrap'),
    formAvatarImg: document.getElementById('form-avatar-img'),
    formAvatarPlaceholder: document.getElementById('form-avatar-placeholder'),
    inputPatientPhoto: document.getElementById('input-patient-photo'),
    btnRemovePhoto: document.getElementById('btn-remove-photo'),
    btnPhotoUploadLabel: document.getElementById('btn-photo-upload-label'),
    modalPhotoViewer: document.getElementById('modal-photo-viewer'),
    photoViewerTitle: document.getElementById('photo-viewer-title'),
    photoViewerImg: document.getElementById('photo-viewer-img'),
    btnDeletePhotoFromViewer: document.getElementById('btn-delete-photo-from-viewer'),

    // Toast container
    toastContainer: document.getElementById('toast-container'),
  };

  const DOC_TITLES = {
    separate: 'الملف المنفصل',
    program: 'ملف البرنامج',
    tests: 'ملف الاختبارات',
    behavioral_plan: 'الخطة السلوكية',
  };

  /* ==========================================================================
     Utility Functions
     ========================================================================== */

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'warning' ? '⚠️' : '✕'}</span>
      <span>${message}</span>
    `;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function openModal(modalEl) {
    modalEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modalEl) {
    modalEl.classList.add('hidden');
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
      document.body.style.overflow = '';
    }

    if (modalEl === elements.modalVideoPlayer) {
      elements.html5VideoPlayer.pause();
      elements.html5VideoPlayer.src = '';
    }
    if (modalEl === elements.modalPdfViewer) {
      elements.pdfIframe.src = '';
    }
    if (modalEl === elements.modalPatientDetails) {
      // Clear viewing state on server
      notifyViewingPatient(null);
      state.selectedPatientId = null;
      state.selectedPatientDetails = null;
      dismissConflictBanner();

      // Clean up URL hash if it was pointing to a patient
      if (window.location.hash.startsWith('#patient=')) {
        history.pushState({}, '', window.location.pathname + window.location.search);
      }
    }
  }

  function attemptCloseModal(modalEl) {
    if (!modalEl) return;
    if (modalEl === elements.modalPatient && state.isEditFormDirty) {
      const confirmDiscard = window.confirm('لديك تعديلات غير محفوظة، هل أنت متأكد من الإغلاق والتراجع؟');
      if (!confirmDiscard) return;
      state.isEditFormDirty = false;
    }
    closeModal(modalEl);
  }

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      const targetModal = document.getElementById(modalId);
      if (targetModal) attemptCloseModal(targetModal);
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) attemptCloseModal(backdrop);
    });
  });

  // Warn before browser tab close or reload if form is dirty
  window.addEventListener('beforeunload', (e) => {
    if (state.isEditFormDirty && !elements.modalPatient.classList.contains('hidden')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isEditingText = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    // 1. Quick search: '/' when not inside another form field
    if (e.key === '/' && !isEditingText) {
      e.preventDefault();
      if (elements.searchInput) {
        elements.searchInput.focus();
        elements.searchInput.select();
      }
      return;
    }

    // 2. Add new patient: Alt + N or F2
    if ((e.altKey && (e.key.toLowerCase() === 'n' || e.key === 'ى')) || e.key === 'F2') {
      e.preventDefault();
      if (elements.btnAddPatient) {
        elements.btnAddPatient.click();
      }
      return;
    }

    // 3. Save patient form: Ctrl + S / Cmd + S when modal is open
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.key === 'س')) {
      if (!elements.modalPatient.classList.contains('hidden')) {
        e.preventDefault();
        if (elements.formPatient) {
          elements.formPatient.requestSubmit();
        }
        return;
      }
    }

    // 4. Escape: Safely close topmost visible modal
    if (e.key === 'Escape') {
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'));
      if (openModals.length > 0) {
        const topModal = openModals[openModals.length - 1];
        attemptCloseModal(topModal);
      }
    }
  });

  /* ==========================================================================
     Real-Time SSE Presence & Conflict Tracking
     ========================================================================== */

  function initRealtimeEvents() {
    if (state.sseSource) {
      state.sseSource.close();
    }

    const sse = new EventSource(`/api/realtime?clientId=${state.clientId}`);
    state.sseSource = sse;

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Presence count update
        if (data.type === 'presence' || data.type === 'connected') {
          if (data.onlineUsers !== undefined) {
            elements.onlineUsersCount.textContent = data.onlineUsers;
          }
        }

        // Viewers on current patient changed
        if (data.type === 'patient_viewers_changed') {
          if (state.selectedPatientId && state.selectedPatientId === data.patientId) {
            updateViewersBadge(data.viewersCount);
          }
        }

        // Patient modified by another client
        if (data.type === 'patient_updated') {
          handleRemotePatientUpdate(data);
        }

        // Patients list created or deleted
        if (data.type === 'patients_list_changed') {
          // If not actively editing, refresh list in background
          if (!state.isEditFormDirty) {
            loadPatients(true);
            loadStats();
          }
        }
      } catch (err) {
        console.error('Error handling SSE message:', err);
      }
    };

    sse.onerror = () => {
      // Auto-reconnect managed by browser EventSource
    };
  }

  async function notifyViewingPatient(patientId) {
    try {
      await fetch('/api/realtime/viewing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: state.clientId, patientId }),
      });
    } catch {
      // Ignore network hiccup
    }
  }

  function updateViewersBadge(count) {
    if (count > 0) {
      elements.detailViewersBadge.textContent = count === 1 ? '👁️ مفتوح على جهاز آخر' : `👁️ مفتوح على ${count} أجهزة أخرى`;
      elements.detailViewersBadge.classList.remove('hidden');
    } else {
      elements.detailViewersBadge.classList.add('hidden');
    }
  }

  function handleRemotePatientUpdate(data) {
    // If update came from another client
    if (data.updatedBy === state.clientId) return;

    // Check if the updated patient is the one currently open on screen
    if (state.selectedPatientId && state.selectedPatientId === data.patientId) {
      if (state.isEditFormDirty) {
        // User has unsaved edits in progress: display prominent conflict warning
        elements.patientConflictAlertContainer.innerHTML = `
          <div class="conflict-alert-banner">
            <div class="conflict-alert-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>تنبيه: تم تعديل بيانات هذا المريض من جهاز آخر.</span>
            </div>
            <div class="conflict-alert-desc">
              لديك تعديلات غير محفوظة. يمكنك تحميل البيانات الأحدث أو الإبقاء على تعديلاتك الحالية.
            </div>
            <div class="conflict-actions-row">
              <button class="btn btn-sm btn-primary" onclick="window.clinicApp.forceRefreshPatient()">
                تحميل البيانات الأحدث
              </button>
              <button class="btn btn-sm btn-outline" onclick="window.clinicApp.dismissConflictBanner()">
                الإبقاء على تعديلاتي الحالية
              </button>
            </div>
          </div>
        `;
      } else {
        // User is just viewing: show non-destructive update notice and auto-refresh
        showToast('تم تعديل الملف من جهاز آخر، جاري التحديث...', 'warning');
        openPatientDetails(data.patientId, false);
      }
    }
  }

  function dismissConflictBanner() {
    elements.patientConflictAlertContainer.innerHTML = '';
  }

  function forceRefreshPatient() {
    dismissConflictBanner();
    state.isEditFormDirty = false;
    closeModal(elements.modalPatient);
    if (state.selectedPatientId) {
      openPatientDetails(state.selectedPatientId, false);
    }
  }

  /* ==========================================================================
     Network & LAN Info
     ========================================================================== */

  async function loadNetworkInfo() {
    try {
      const res = await fetch('/api/network');
      if (!res.ok) return;
      const data = await res.json();
      state.networkInfo = data;

      elements.navLanIp.textContent = data.lanUrl.replace('http://', '');
      elements.networkLanUrl.textContent = data.lanUrl;
      if (data.qrCodeDataUrl) {
        elements.networkQrImage.src = data.qrCodeDataUrl;
        if (elements.statNetworkQrThumb) {
          elements.statNetworkQrThumb.src = data.qrCodeDataUrl;
        }
      }
    } catch (err) {
      console.warn('Failed to load network info:', err);
    }
  }

  elements.btnNetworkInfo.addEventListener('click', () => {
    openModal(elements.modalNetwork);
  });

  elements.btnCopyLanUrl.addEventListener('click', () => {
    if (state.networkInfo?.lanUrl) {
      navigator.clipboard.writeText(state.networkInfo.lanUrl).then(() => {
        showToast('تم نسخ رابط البرنامج');
      });
    }
  });

  // Share direct patient profile with QR code modal
  elements.btnCopyPatientLink.addEventListener('click', async () => {
    if (!state.selectedPatientId || !state.selectedPatientDetails) return;
    const p = state.selectedPatientDetails;
    const baseLan = state.networkInfo?.lanUrl || window.location.origin;
    const directUrl = `${baseLan}/#patient=${state.selectedPatientId}`;

    elements.sharePatientName.textContent = p.full_name;
    elements.sharePatientFileNumber.textContent = p.file_number;
    elements.sharePatientUrl.textContent = directUrl;

    if (elements.btnPatientQrThumb && elements.btnPatientQrThumb.src.startsWith('data:image')) {
      elements.sharePatientQrImage.src = elements.btnPatientQrThumb.src;
    } else {
      elements.sharePatientQrImage.src = '';
    }

    openModal(elements.modalSharePatient);

    if (!elements.sharePatientQrImage.src) {
      try {
        const qrRes = await fetch(`/api/qrcode?text=${encodeURIComponent(directUrl)}`);
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          elements.sharePatientQrImage.src = qrData.qrCodeDataUrl;
          if (elements.btnPatientQrThumb) {
            elements.btnPatientQrThumb.src = qrData.qrCodeDataUrl;
          }
        }
      } catch (err) {
        console.warn('Failed to load patient QR code:', err);
      }
    }
  });

  elements.btnCopyShareUrl.addEventListener('click', () => {
    const url = elements.sharePatientUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      showToast('تم نسخ رابط ملف المريض بنجاح');
    }).catch(() => {
      showToast(url);
    });
  });

  /* ==========================================================================
     Statistics
     ========================================================================== */

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const stats = await res.json();

      elements.statPatientsCount.textContent = Number(stats.totalPatients).toLocaleString('ar-EG');
      if (elements.statPatientsTodayCount) {
        elements.statPatientsTodayCount.textContent = Number(stats.todayPatients || 0).toLocaleString('ar-EG');
      }
      elements.statDocumentsCount.textContent = Number(stats.totalDocuments).toLocaleString('ar-EG');
      elements.statVideosCount.textContent = Number(stats.totalVideos).toLocaleString('ar-EG');
      elements.statStorageSize.textContent = formatBytes(stats.totalStorageBytes);

      const rCount = Number(stats.recycleBinCount || 0);
      if (elements.statRecycleCount) {
        elements.statRecycleCount.textContent = rCount.toLocaleString('ar-EG');
      }
      if (elements.tabAllBadge) {
        elements.tabAllBadge.textContent = Number(stats.totalPatients || 0).toLocaleString('ar-EG');
      }
      if (elements.tabMaleBadge) {
        elements.tabMaleBadge.textContent = Number(stats.malePatients || 0).toLocaleString('ar-EG');
      }
      if (elements.tabFemaleBadge) {
        elements.tabFemaleBadge.textContent = Number(stats.femalePatients || 0).toLocaleString('ar-EG');
      }
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
     Patients List, Table Tabs & Search
     ========================================================================== */

  async function loadPatients(silent = false) {
    if (state.activeTab === 'recycle') {
      return loadRecycleBinPatients(silent);
    }

    try {
      const params = new URLSearchParams({
        page: state.currentPage,
        limit: state.limit,
      });

      if (state.searchQuery) params.append('q', state.searchQuery);
      if (state.genderFilter) params.append('gender', state.genderFilter);
      if (state.startDate) params.append('startDate', state.startDate);
      if (state.endDate) params.append('endDate', state.endDate);
      if (state.hasFilesFilter && state.hasFilesFilter !== 'all') {
        params.append('hasFiles', state.hasFilesFilter);
      }
      if (state.sortBy && state.sortBy !== 'created_desc') {
        params.append('sortBy', state.sortBy);
      }

      const res = await fetch(`/api/patients?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch patients');

      const data = await res.json();
      state.patients = data.patients;
      state.totalPatients = data.total;
      state.totalPages = data.totalPages;

      renderPatientsTable();
    } catch (err) {
      if (!silent) {
        console.error(err);
        showToast('خطأ أثناء تحميل بيانات المرضى', 'danger');
      }
    }
  }

  async function loadRecycleBinPatients(silent = false) {
    try {
      const params = new URLSearchParams({
        page: state.currentPage,
        limit: state.limit,
      });

      if (state.searchQuery) params.append('q', state.searchQuery);
      if (state.genderFilter) params.append('gender', state.genderFilter);
      if (state.startDate) params.append('startDate', state.startDate);
      if (state.endDate) params.append('endDate', state.endDate);
      if (state.sortBy && state.sortBy !== 'created_desc') {
        params.append('sortBy', state.sortBy);
      }

      const res = await fetch(`/api/recycle-bin?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch recycle bin');

      const data = await res.json();
      state.patients = data.patients || [];
      state.totalPatients = data.total;
      state.totalPages = data.totalPages;

      renderPatientsTable();
    } catch (err) {
      if (!silent) {
        console.error(err);
        showToast('خطأ أثناء تحميل سلة المحذوفات', 'danger');
      }
    }
  }

  function updateBatchToolbar() {
    const selectedCount = state.selectedPatientIds.size;
    if (selectedCount > 0) {
      elements.batchActionsBar.classList.remove('hidden');
      elements.batchSelectedCount.textContent = selectedCount.toLocaleString('ar-EG');
    } else {
      elements.batchActionsBar.classList.add('hidden');
    }

    if (state.patients.length === 0) {
      if (elements.selectAllCheckbox) {
        elements.selectAllCheckbox.checked = false;
        elements.selectAllCheckbox.indeterminate = false;
      }
      return;
    }

    const visibleSelectedCount = state.patients.filter((p) => state.selectedPatientIds.has(p.id)).length;
    if (elements.selectAllCheckbox) {
      if (visibleSelectedCount === state.patients.length && visibleSelectedCount > 0) {
        elements.selectAllCheckbox.checked = true;
        elements.selectAllCheckbox.indeterminate = false;
      } else if (visibleSelectedCount > 0) {
        elements.selectAllCheckbox.checked = false;
        elements.selectAllCheckbox.indeterminate = true;
      } else {
        elements.selectAllCheckbox.checked = false;
        elements.selectAllCheckbox.indeterminate = false;
      }
    }

    const rows = elements.patientsTableBody.querySelectorAll('tr[data-patient-id]');
    rows.forEach((row) => {
      const id = parseInt(row.getAttribute('data-patient-id'), 10);
      const isSelected = state.selectedPatientIds.has(id);
      row.classList.toggle('selected', isSelected);
      const cb = row.querySelector('.table-checkbox');
      if (cb) cb.checked = isSelected;
    });
  }

  function renderPatientsTable() {
    elements.patientsTableBody.innerHTML = '';
    const isRecycle = state.activeTab === 'recycle';

    if (elements.tableActiveTitle) {
      elements.tableActiveTitle.textContent = isRecycle ? 'سجلات سلة المحذوفات' : 'قائمة المرضى المسجلين';
    }
    elements.resultsCountBadge.textContent = `${Number(state.totalPatients).toLocaleString('ar-EG')} مريض`;

    if (elements.thColDiag) {
      elements.thColDiag.textContent = isRecycle ? 'التشخيص / الحالة' : 'التشخيص';
    }
    if (elements.thColDate) {
      elements.thColDate.textContent = isRecycle ? 'تاريخ الحذف' : 'تاريخ التسجيل';
    }
    if (elements.thColActions) {
      elements.thColActions.classList.toggle('hidden', !isRecycle);
    }
    if (elements.btnEmptyRecycleTab) {
      elements.btnEmptyRecycleTab.classList.toggle('hidden', !isRecycle || state.totalPatients === 0);
    }

    // Toggle batch toolbar buttons
    if (elements.btnBatchDelete) {
      elements.btnBatchDelete.classList.toggle('hidden', isRecycle);
    }
    if (elements.btnTabRecycleRestore) {
      elements.btnTabRecycleRestore.classList.toggle('hidden', !isRecycle);
    }
    if (elements.btnTabRecyclePermanent) {
      elements.btnTabRecyclePermanent.classList.toggle('hidden', !isRecycle);
    }

    if (state.patients.length === 0) {
      elements.patientsTableElement.classList.add('hidden');
      elements.emptyState.classList.remove('hidden');
      elements.paginationSection.classList.add('hidden');

      const emptyTitle = elements.emptyState.querySelector('h3');
      const emptyDesc = elements.emptyState.querySelector('p');
      if (emptyTitle) {
        emptyTitle.textContent = isRecycle ? 'سلة المحذوفات فارغة' : 'لا يوجد مرضى مسجلين حتى الآن';
      }
      if (emptyDesc) {
        emptyDesc.textContent = isRecycle ? 'لا توجد سجلات مرضى محذوفة حالياً.' : 'اضغط على زر "مريض جديد" لتسجيل مريض والبدء في حفظ بياناته وملفاته.';
      }
      if (elements.btnEmptyAddPatient) {
        elements.btnEmptyAddPatient.classList.toggle('hidden', isRecycle);
      }
      updateBatchToolbar();
      return;
    }

    elements.patientsTableElement.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
    elements.paginationSection.classList.remove('hidden');

    state.patients.forEach((patient) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-patient-id', patient.id);
      const isSelected = state.selectedPatientIds.has(patient.id);
      if (isSelected) tr.classList.add('selected');

      const genderBadge = patient.gender === 'female'
        ? '<span class="gender-badge female">أنثى</span>'
        : '<span class="gender-badge male">ذكر</span>';

      const ageText = patient.age ? `${patient.age} سنة` : '—';
      const dateText = isRecycle
        ? (patient.deleted_at ? formatDate(patient.deleted_at) : '—')
        : formatDate(patient.created_at);

      const actionButtons = isRecycle
        ? `
          <td class="td-actions" style="text-align: center;">
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button class="btn btn-sm btn-primary" data-action="recycle-restore" data-id="${patient.id}" title="استعادة المريض">
                استعادة
              </button>
              <button class="btn btn-sm btn-danger-outline" data-action="recycle-permanent" data-id="${patient.id}" title="حذف نهائي">
                حذف نهائي
              </button>
            </div>
          </td>
        `
        : '';

      tr.innerHTML = `
        <td class="td-checkbox">
          <input type="checkbox" class="table-checkbox" data-patient-id="${patient.id}" ${isSelected ? 'checked' : ''} aria-label="تحديد المريض">
        </td>
        <td class="td-file"><span class="file-code-badge">${patient.file_number}</span></td>
        <td class="td-name">
          <div class="patient-name-cell">
            <div class="patient-avatar-wrap sm">
              ${patient.photo_url
                ? `<img src="${patient.photo_url}" class="patient-avatar-img" alt="${patient.full_name}" loading="lazy">`
                : `<div class="patient-avatar-fallback ${patient.gender === 'female' ? 'avatar-female' : 'avatar-male'}">${(patient.full_name || '').trim().charAt(0) || 'م'}</div>`
              }
            </div>
            <span class="patient-name-text">${patient.full_name}</span>
          </div>
        </td>
        <td class="td-phone">${patient.phone ? `<a href="tel:${patient.phone}" class="patient-phone-link">${patient.phone}</a>` : '—'}</td>
        <td class="td-gender-age">${genderBadge} / ${ageText}</td>
        <td class="td-diagnosis">${patient.diagnosis ? `<span title="${patient.diagnosis}">${patient.diagnosis.substring(0, 32)}${patient.diagnosis.length > 32 ? '...' : ''}</span>` : '—'}</td>
        <td class="td-date">${dateText}</td>
        ${actionButtons}
      `;

      elements.patientsTableBody.appendChild(tr);
    });

    updateBatchToolbar();

    elements.paginationInfoText.textContent = `صفحة ${state.currentPage} من ${state.totalPages}`;
    elements.btnPrevPage.disabled = state.currentPage <= 1;
    elements.btnNextPage.disabled = state.currentPage >= state.totalPages;
  }

  // Row and checkbox interactions
  elements.patientsTableBody.addEventListener('click', async (e) => {
    // If clicked on checkbox
    if (e.target.matches('.table-checkbox')) {
      const id = parseInt(e.target.getAttribute('data-patient-id'), 10);
      if (e.target.checked) {
        state.selectedPatientIds.add(id);
      } else {
        state.selectedPatientIds.delete(id);
      }
      updateBatchToolbar();
      return;
    }

    // Recycle tab restore action
    const restoreBtn = e.target.closest('button[data-action="recycle-restore"]');
    if (restoreBtn) {
      const id = parseInt(restoreBtn.getAttribute('data-id'), 10);
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
      return;
    }

    // Recycle tab permanent delete action
    const permBtn = e.target.closest('button[data-action="recycle-permanent"]');
    if (permBtn) {
      const id = parseInt(permBtn.getAttribute('data-id'), 10);
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
      return;
    }

    // If clicked on phone link, allow phone app to open without popping modal
    if (e.target.closest('a[href^="tel:"]')) {
      return;
    }

    // Clicking anywhere on row opens the full patient profile
    const row = e.target.closest('tr[data-patient-id]');
    if (row) {
      const id = parseInt(row.getAttribute('data-patient-id'), 10);
      openPatientDetails(id);
    }
  });

  // Switch between table tabs (All, Male, Female, Recycle Bin)
  function switchTab(tab) {
    state.activeTab = tab;
    state.currentPage = 1;
    state.selectedPatientIds.clear();

    if (elements.tableTabsNav) {
      const tabs = elements.tableTabsNav.querySelectorAll('.table-tab');
      tabs.forEach((btn) => {
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

    loadPatients();
  }

  if (elements.tableTabsNav) {
    elements.tableTabsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.table-tab');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  }

  // Stat card row shortcut to switch to recycle tab
  if (elements.statRowRecycle) {
    elements.statRowRecycle.addEventListener('click', () => {
      switchTab('recycle');
      elements.patientsTableElement?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Select all checkbox in table header
  if (elements.selectAllCheckbox) {
    elements.selectAllCheckbox.addEventListener('change', () => {
      const isChecked = elements.selectAllCheckbox.checked;
      state.patients.forEach((patient) => {
        if (isChecked) {
          state.selectedPatientIds.add(patient.id);
        } else {
          state.selectedPatientIds.delete(patient.id);
        }
      });
      updateBatchToolbar();
    });
  }

  // Batch toolbar cancel
  if (elements.btnBatchCancel) {
    elements.btnBatchCancel.addEventListener('click', () => {
      state.selectedPatientIds.clear();
      updateBatchToolbar();
    });
  }

  // Batch delete selected patients (moves to recycle bin)
  if (elements.btnBatchDelete) {
    elements.btnBatchDelete.addEventListener('click', async () => {
      const count = state.selectedPatientIds.size;
      if (count === 0) return;

      const ok = confirm(`هل أنت متأكد من نقل ${count} مريض محدد إلى سلة المحذوفات؟\nملاحظة: ستبقى كافة ملفاتهم وفيديوهاتهم محفوظة ويمكنك استعادتها في أي وقت.`);
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
          throw new Error(data.error || 'Failed to move selected patients to recycle bin');
        }

        showToast(`تم نقل ${count} مريض إلى سلة المحذوفات`);
        state.selectedPatientIds.clear();
        updateBatchToolbar();
        loadPatients();
        loadStats();
      } catch (err) {
        console.error(err);
        showToast('خطأ أثناء نقل المرضى المحددين إلى سلة المحذوفات', 'danger');
      }
    });
  }

  // Batch restore in recycle tab
  if (elements.btnTabRecycleRestore) {
    elements.btnTabRecycleRestore.addEventListener('click', async () => {
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
  }

  // Batch permanent delete in recycle tab
  if (elements.btnTabRecyclePermanent) {
    elements.btnTabRecyclePermanent.addEventListener('click', async () => {
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
  }

  // Empty recycle bin button on tab
  if (elements.btnEmptyRecycleTab) {
    elements.btnEmptyRecycleTab.addEventListener('click', async () => {
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
  }

  // Empty state button triggers add patient
  elements.btnEmptyAddPatient.addEventListener('click', () => {
    elements.btnAddPatient.click();
  });

  // Instant debounced search
  let searchDebounceTimer = null;
  elements.searchInput.addEventListener('input', () => {
    const val = elements.searchInput.value.trim();
    elements.searchClearBtn.classList.toggle('hidden', val.length === 0);

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.searchQuery = val;
      state.currentPage = 1;
      loadPatients();
    }, 200);
  });

  elements.searchClearBtn.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.searchClearBtn.classList.add('hidden');
    state.searchQuery = '';
    state.currentPage = 1;
    updateActiveFiltersIndicator();
    loadPatients();
  });

  /* ==========================================================================
     Advanced Filters Controller
     ========================================================================== */

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

  if (elements.btnToggleFilters && elements.advancedFiltersPanel) {
    elements.btnToggleFilters.addEventListener('click', () => {
      elements.advancedFiltersPanel.classList.toggle('hidden');
    });
  }

  if (elements.datePresetButtons) {
    elements.datePresetButtons.addEventListener('click', (e) => {
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
          const start = `${year}-${month}-01`;
          const end = now.toISOString().split('T')[0];
          state.startDate = start;
          state.endDate = end;
        }
      }

      state.currentPage = 1;
      updateActiveFiltersIndicator();
      loadPatients();
    });
  }

  if (elements.filterDateFrom) {
    elements.filterDateFrom.addEventListener('change', () => {
      state.startDate = elements.filterDateFrom.value;
      state.currentPage = 1;
      updateActiveFiltersIndicator();
      loadPatients();
    });
  }

  if (elements.filterDateTo) {
    elements.filterDateTo.addEventListener('change', () => {
      state.endDate = elements.filterDateTo.value;
      state.currentPage = 1;
      updateActiveFiltersIndicator();
      loadPatients();
    });
  }

  if (elements.filterHasFiles) {
    elements.filterHasFiles.addEventListener('change', () => {
      state.hasFilesFilter = elements.filterHasFiles.value;
      state.currentPage = 1;
      updateActiveFiltersIndicator();
      loadPatients();
    });
  }

  if (elements.filterSortBy) {
    elements.filterSortBy.addEventListener('change', () => {
      state.sortBy = elements.filterSortBy.value;
      state.currentPage = 1;
      updateActiveFiltersIndicator();
      loadPatients();
    });
  }

  if (elements.btnResetFilters) {
    elements.btnResetFilters.addEventListener('click', () => {
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

      if (elements.customDateInputs) {
        elements.customDateInputs.classList.add('hidden');
      }
      if (elements.filterDateFrom) elements.filterDateFrom.value = '';
      if (elements.filterDateTo) elements.filterDateTo.value = '';
      if (elements.filterHasFiles) elements.filterHasFiles.value = 'all';
      if (elements.filterSortBy) elements.filterSortBy.value = 'created_desc';

      updateActiveFiltersIndicator();
      loadPatients();
    });
  }

  elements.btnPrevPage.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      loadPatients();
    }
  });

  elements.btnNextPage.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      loadPatients();
    }
  });

  /* ==========================================================================
     Patient CRUD & Form Dirty Tracking
     ========================================================================== */

  // Mark form as dirty whenever an input changes
  elements.formPatient.querySelectorAll('input, select, textarea').forEach((input) => {
    input.addEventListener('input', () => {
      state.isEditFormDirty = true;
    });
  });

  function resetFormAvatar(photoUrl = null) {
    state.pendingPhotoBase64 = null;
    state.removePhotoPending = false;
    if (elements.inputPatientPhoto) elements.inputPatientPhoto.value = '';

    if (photoUrl) {
      if (elements.formAvatarImg) {
        elements.formAvatarImg.src = photoUrl;
        elements.formAvatarImg.classList.remove('hidden');
      }
      if (elements.formAvatarPlaceholder) {
        elements.formAvatarPlaceholder.classList.add('hidden');
      }
      if (elements.btnRemovePhoto) {
        elements.btnRemovePhoto.classList.remove('hidden');
      }
      if (elements.btnPhotoUploadLabel) {
        elements.btnPhotoUploadLabel.textContent = 'تغيير الصورة';
      }
    } else {
      if (elements.formAvatarImg) {
        elements.formAvatarImg.src = '';
        elements.formAvatarImg.classList.add('hidden');
      }
      if (elements.formAvatarPlaceholder) {
        elements.formAvatarPlaceholder.classList.remove('hidden');
      }
      if (elements.btnRemovePhoto) {
        elements.btnRemovePhoto.classList.add('hidden');
      }
      if (elements.btnPhotoUploadLabel) {
        elements.btnPhotoUploadLabel.textContent = 'اختيار صورة المريض';
      }
    }
  }

  if (elements.inputPatientPhoto) {
    elements.inputPatientPhoto.addEventListener('change', () => {
      const file = elements.inputPatientPhoto.files && elements.inputPatientPhoto.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('يرجى اختيار ملف صورة صالح (JPG, PNG, WebP)', 'warning');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        showToast('حجم الصورة كبير جداً، الحد الأقصى 10 ميجابايت', 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        state.pendingPhotoBase64 = e.target.result;
        state.removePhotoPending = false;
        state.isEditFormDirty = true;

        if (elements.formAvatarImg) {
          elements.formAvatarImg.src = e.target.result;
          elements.formAvatarImg.classList.remove('hidden');
        }
        if (elements.formAvatarPlaceholder) {
          elements.formAvatarPlaceholder.classList.add('hidden');
        }
        if (elements.btnRemovePhoto) {
          elements.btnRemovePhoto.classList.remove('hidden');
        }
        if (elements.btnPhotoUploadLabel) {
          elements.btnPhotoUploadLabel.textContent = 'تغيير الصورة';
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (elements.btnRemovePhoto) {
    elements.btnRemovePhoto.addEventListener('click', () => {
      state.pendingPhotoBase64 = null;
      state.removePhotoPending = true;
      state.isEditFormDirty = true;
      if (elements.inputPatientPhoto) elements.inputPatientPhoto.value = '';

      if (elements.formAvatarImg) {
        elements.formAvatarImg.src = '';
        elements.formAvatarImg.classList.add('hidden');
      }
      if (elements.formAvatarPlaceholder) {
        elements.formAvatarPlaceholder.classList.remove('hidden');
      }
      elements.btnRemovePhoto.classList.add('hidden');
      if (elements.btnPhotoUploadLabel) {
        elements.btnPhotoUploadLabel.textContent = 'اختيار صورة المريض';
      }
    });
  }

  elements.btnAddPatient.addEventListener('click', () => {
    elements.modalPatientTitle.textContent = 'إضافة مريض جديد';
    elements.patientFormId.value = '';
    elements.formPatient.reset();
    elements.inputGender.value = '';
    resetFormAvatar(null);
    state.isEditFormDirty = false;
    state.saveActionTarget = 'upload';
    if (elements.btnSavePatientText) {
      elements.btnSavePatientText.textContent = 'الحفظ والانتقال لرفع الملفات ←';
    }
    if (elements.btnSavePatientOnly) {
      elements.btnSavePatientOnly.style.display = 'inline-flex';
    }
    openModal(elements.modalPatient);
  });

  async function openEditPatientModal(id) {
    try {
      const res = await fetch(`/api/patients/${id}`);
      if (!res.ok) throw new Error('Failed to load patient');
      const p = await res.json();

      elements.modalPatientTitle.textContent = 'تعديل بيانات المريض';
      elements.patientFormId.value = p.id;
      elements.inputFullName.value = p.full_name || '';
      elements.inputFileNumber.value = p.file_number || '';
      elements.inputPhone.value = p.phone || '';
      elements.inputNationalId.value = p.national_id || '';
      elements.inputGender.value = p.gender === 'female' ? 'female' : 'male';
      elements.inputAge.value = p.age !== null ? p.age : '';
      elements.inputBirthDate.value = p.birth_date || '';
      elements.inputDiagnosis.value = p.diagnosis || '';
      elements.inputNotes.value = p.notes || '';

      resetFormAvatar(p.photo_url || null);

      state.isEditFormDirty = false;
      state.saveActionTarget = 'save';
      if (elements.btnSavePatientText) {
        elements.btnSavePatientText.textContent = 'حفظ التعديلات';
      }
      if (elements.btnSavePatientOnly) {
        elements.btnSavePatientOnly.style.display = 'none';
      }
      openModal(elements.modalPatient);
    } catch (err) {
      showToast('خطأ في تحميل بيانات المريض', 'danger');
    }
  }

  if (elements.btnSavePatient) {
    elements.btnSavePatient.addEventListener('click', () => {
      if (!elements.patientFormId.value) {
        state.saveActionTarget = 'upload';
      }
    });
  }

  if (elements.btnSavePatientOnly) {
    elements.btnSavePatientOnly.addEventListener('click', () => {
      state.saveActionTarget = 'only';
    });
  }

  elements.formPatient.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = elements.patientFormId.value;
    const isEdit = Boolean(id);

    // If editing existing patient, verify if other users are currently viewing
    if (isEdit) {
      try {
        const viewersRes = await fetch(`/api/patients/${id}/viewers?clientId=${state.clientId}`);
        if (viewersRes.ok) {
          const viewersData = await viewersRes.json();
          if (viewersData.viewersCount > 0) {
            const confirmSave = confirm(
              `⚠️ تنبيه: هذا الملف مفتوح حالياً على جهاز آخر.\n\nهل تريد المتابعة وحفظ التعديلات؟`
            );
            if (!confirmSave) return;
          }
        }
      } catch {
        // Proceed on network error
      }
    }

    if (!elements.inputGender.value) {
      showToast('يرجى اختيار نوع المريض (ذكر أو أنثى)', 'warning');
      elements.inputGender.focus();
      return;
    }

    const payload = {
      full_name: elements.inputFullName.value.trim(),
      file_number: elements.inputFileNumber.value.trim() || undefined,
      phone: elements.inputPhone.value.trim() || undefined,
      national_id: elements.inputNationalId.value.trim() || undefined,
      gender: elements.inputGender.value,
      age: elements.inputAge.value ? parseInt(elements.inputAge.value, 10) : undefined,
      birth_date: elements.inputBirthDate.value || undefined,
      diagnosis: elements.inputDiagnosis.value.trim() || undefined,
      notes: elements.inputNotes.value.trim() || undefined,
      photo_base64: state.pendingPhotoBase64 || undefined,
      remove_photo: state.removePhotoPending || undefined,
    };

    try {
      const url = isEdit ? `/api/patients/${id}?clientId=${state.clientId}` : '/api/patients';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'فشلت العملية', 'danger');
        return;
      }

      state.isEditFormDirty = false;
      resetFormAvatar(null);
      dismissConflictBanner();
      closeModal(elements.modalPatient);

      loadPatients();
      loadStats();

      if (isEdit) {
        showToast('تم تحديث بيانات المريض بنجاح');
        if (state.selectedPatientId === parseInt(id, 10)) {
          openPatientDetails(state.selectedPatientId, false);
        }
      } else {
        const newPatientId = data.id;
        if (state.saveActionTarget === 'upload' && newPatientId) {
          showToast('تم حفظ المريض بنجاح، يمكنك الآن رفع الملفات والفيديوهات');
          openPatientDetails(newPatientId, true);
          setTimeout(() => {
            const docSection = elements.modalPatientDetails.querySelector('.documents-section-header');
            if (docSection) {
              docSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 350);
        } else {
          showToast('تمت إضافة المريض بنجاح');
        }
      }
    } catch (err) {
      showToast('حدث خطأ أثناء حفظ المريض', 'danger');
    }
  });

  async function confirmDeletePatient(id) {
    const patient = state.patients.find((p) => p.id === id);
    const name = patient ? patient.full_name : 'هذا المريض';

    const ok = confirm(`هل أنت متأكد من نقل ${name} إلى سلة المحذوفات؟\nملاحظة: ستبقى كافة ملفاته وفيديوهاته محفوظة ويمكنك استعادتها في أي وقت.`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/patients/${id}?clientId=${state.clientId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');

      showToast('تم نقل المريض إلى سلة المحذوفات بنجاح');
      if (state.selectedPatientId === id) {
        closeModal(elements.modalPatientDetails);
      }
      loadPatients();
      loadStats();
    } catch (err) {
      showToast('خطأ أثناء نقل المريض إلى سلة المحذوفات', 'danger');
    }
  }

  /* ==========================================================================
     Patient Full Details, 5 Files & URL Routing
     ========================================================================== */

  async function openPatientDetails(id, updateUrl = true) {
    try {
      const res = await fetch(`/api/patients/${id}`);
      if (!res.ok) throw new Error('Patient not found');

      const p = await res.json();
      state.selectedPatientId = p.id;
      state.selectedPatientDetails = p;

      // Update URL hash for easy sharing across LAN
      if (updateUrl) {
        history.pushState({ patientId: id }, '', `#patient=${id}`);
      }

      // Notify server of active viewing
      notifyViewingPatient(p.id);

      // Check current viewers
      fetch(`/api/patients/${p.id}/viewers?clientId=${state.clientId}`)
        .then((r) => r.json())
        .then((v) => updateViewersBadge(v.viewersCount))
        .catch(() => {});

      // Clear previous conflict warnings
      dismissConflictBanner();

      // Populate avatar in details modal header
      const firstChar = (p.full_name || '').trim().charAt(0) || 'م';
      const fallbackClass = p.gender === 'female' ? 'avatar-female' : 'avatar-male';
      if (elements.detailAvatarFallback) {
        elements.detailAvatarFallback.textContent = firstChar;
        elements.detailAvatarFallback.className = `patient-avatar-fallback ${fallbackClass}`;
      }
      if (p.photo_url) {
        if (elements.detailAvatarImg) {
          elements.detailAvatarImg.src = p.photo_url;
          elements.detailAvatarImg.classList.remove('hidden');
        }
        if (elements.detailAvatarFallback) {
          elements.detailAvatarFallback.classList.add('hidden');
        }
        if (elements.detailAvatarWrap) {
          elements.detailAvatarWrap.style.cursor = 'pointer';
          elements.detailAvatarWrap.title = 'انقر لتكبير صورة المريض';
        }
      } else {
        if (elements.detailAvatarImg) {
          elements.detailAvatarImg.src = '';
          elements.detailAvatarImg.classList.add('hidden');
        }
        if (elements.detailAvatarFallback) {
          elements.detailAvatarFallback.classList.remove('hidden');
        }
        if (elements.detailAvatarWrap) {
          elements.detailAvatarWrap.style.cursor = 'default';
          elements.detailAvatarWrap.title = 'لا توجد صورة شخصية للمريض (انقر على أيقونة الكاميرا لإضافة صورة)';
        }
      }

      // Populate header details
      elements.detailFileNumber.textContent = p.file_number;
      elements.detailFullName.textContent = p.full_name;

      const genderText = p.gender === 'female' ? 'أنثى' : 'ذكر';
      const ageText = p.age ? `${p.age} سنة` : 'العمر غير مسجل';
      const phoneText = p.phone ? `هاتف: ${p.phone}` : 'بدون هاتف';
      const dateText = `تاريخ التسجيل: ${formatDate(p.created_at)}`;

      elements.detailMetaRow.innerHTML = `
        <span>${genderText}</span>
        <span>•</span>
        <span>${ageText}</span>
        <span>•</span>
        <span>${phoneText}</span>
        <span>•</span>
        <span>${dateText}</span>
      `;

      elements.detailDiagnosis.textContent = p.diagnosis || 'لا يوجد تشخيص مسجل حالياً';
      elements.detailNotes.textContent = p.notes || 'لا توجد ملاحظات مسجلة';

      renderDocCard('separate', elements.bodyDocSeparate, p.documents?.separate_file_name, p.documents?.separate_file_size, p.documents?.separate_updated_at);
      renderDocCard('program', elements.bodyDocProgram, p.documents?.program_file_name, p.documents?.program_file_size, p.documents?.program_updated_at);
      renderDocCard('tests', elements.bodyDocTests, p.documents?.tests_file_name, p.documents?.tests_file_size, p.documents?.tests_updated_at);
      renderDocCard('behavioral_plan', elements.bodyDocBehavioralPlan, p.documents?.behavioral_plan_file_name, p.documents?.behavioral_plan_file_size, p.documents?.behavioral_plan_updated_at);

      renderVideosSection(p.videos || []);

      // Pre-load and render patient QR thumbnail in the share button
      const baseLan = state.networkInfo?.lanUrl || window.location.origin;
      const directUrl = `${baseLan}/#patient=${p.id}`;
      if (elements.btnPatientQrThumb) {
        fetch(`/api/qrcode?text=${encodeURIComponent(directUrl)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((qrData) => {
            if (qrData?.qrCodeDataUrl && state.selectedPatientId === p.id) {
              elements.btnPatientQrThumb.src = qrData.qrCodeDataUrl;
              if (elements.sharePatientQrImage) {
                elements.sharePatientQrImage.src = qrData.qrCodeDataUrl;
              }
            }
          })
          .catch(() => {});
      }

      openModal(elements.modalPatientDetails);
    } catch (err) {
      console.error(err);
      showToast('تعذر فتح الملف الطبي للمريض', 'danger');
    }
  }

  // Handle URL Hash and history navigation on load or popstate
  function checkUrlForPatient() {
    const hash = window.location.hash;
    const match = hash.match(/patient=(\d+)/);
    if (match && match[1]) {
      const patientId = parseInt(match[1], 10);
      openPatientDetails(patientId, false);
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('patient');
    if (paramId) {
      openPatientDetails(parseInt(paramId, 10), false);
    }
  }

  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.patientId) {
      openPatientDetails(e.state.patientId, false);
    } else if (!window.location.hash.includes('patient=')) {
      if (!elements.modalPatientDetails.classList.contains('hidden')) {
        closeModal(elements.modalPatientDetails);
      }
    }
  });

  elements.btnEditPatientDetails.addEventListener('click', () => {
    if (state.selectedPatientId) {
      openEditPatientModal(state.selectedPatientId);
    }
  });

  if (elements.btnDetailsAddAnother) {
    elements.btnDetailsAddAnother.addEventListener('click', () => {
      closeModal(elements.modalPatientDetails);
      elements.btnAddPatient.click();
    });
  }

  // Lightbox and detail avatar event listeners
  if (elements.detailAvatarWrap) {
    elements.detailAvatarWrap.addEventListener('click', () => {
      const p = state.selectedPatientDetails;
      if (p && p.photo_url) {
        if (elements.photoViewerImg) elements.photoViewerImg.src = p.photo_url;
        if (elements.photoViewerTitle) elements.photoViewerTitle.textContent = `صورة المريض - ${p.full_name}`;
        openModal(elements.modalPhotoViewer);
      }
    });
  }

  if (elements.btnChangeDetailPhoto && elements.inputDetailPhoto) {
    elements.btnChangeDetailPhoto.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.inputDetailPhoto.value = '';
      elements.inputDetailPhoto.click();
    });

    elements.inputDetailPhoto.addEventListener('change', async () => {
      const file = elements.inputDetailPhoto.files && elements.inputDetailPhoto.files[0];
      if (!file || !state.selectedPatientId) return;

      if (!file.type.startsWith('image/')) {
        showToast('يرجى اختيار ملف صورة صالح (JPG, PNG, WebP)', 'warning');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        showToast('حجم الصورة كبير جداً، الحد الأقصى 10 ميجابايت', 'warning');
        return;
      }

      try {
        const formData = new FormData();
        formData.append('photo', file);

        showToast('جاري تحديث صورة المريض...', 'info');
        const res = await fetch(`/api/patients/${state.selectedPatientId}/photo`, {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'فشل تحديث الصورة', 'danger');
          return;
        }

        showToast('تم تحديث صورة المريض بنجاح', 'success');
        openPatientDetails(state.selectedPatientId, false);
        loadPatients();
      } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء رفع الصورة', 'danger');
      }
    });
  }

  if (elements.btnDeletePhotoFromViewer) {
    elements.btnDeletePhotoFromViewer.addEventListener('click', async () => {
      if (!state.selectedPatientId) return;
      const confirmDelete = confirm('هل أنت متأكد من رغبتك في حذف صورة هذا المريض؟');
      if (!confirmDelete) return;

      try {
        const res = await fetch(`/api/patients/${state.selectedPatientId}/photo`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'فشل حذف الصورة', 'danger');
          return;
        }

        showToast('تم حذف صورة المريض بنجاح', 'success');
        closeModal(elements.modalPhotoViewer);
        openPatientDetails(state.selectedPatientId, false);
        loadPatients();
      } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء حذف الصورة', 'danger');
      }
    });
  }

  function renderDocCard(docType, containerEl, fileName, fileSize, updatedAt) {
    const isUploaded = Boolean(fileName);

    if (isUploaded) {
      containerEl.innerHTML = `
        <div class="file-status-indicator uploaded">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>تم رفع الملف</span>
        </div>
        <div class="file-meta-info">
          <span>الحجم: ${formatBytes(fileSize)}</span>
          <span>تاريخ التحديث: ${formatDate(updatedAt)}</span>
        </div>
        <div class="doc-card-actions">
          <button class="btn btn-sm btn-primary" onclick="window.clinicApp.viewPdf('${docType}')">
            عرض الملف
          </button>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline" style="flex:1;" onclick="window.clinicApp.triggerUploadPdf('${docType}')">
              استبدال
            </button>
            <button class="btn btn-sm btn-danger-outline" onclick="window.clinicApp.deletePdf('${docType}')">
              حذف
            </button>
          </div>
        </div>
      `;
    } else {
      containerEl.innerHTML = `
        <div class="file-status-indicator not-uploaded">
          <span>لم يتم رفع الملف بعد</span>
        </div>
        <div class="doc-card-actions" style="margin-top: auto;">
          <button class="btn btn-sm btn-outline" onclick="window.clinicApp.triggerUploadPdf('${docType}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>رفع الملف</span>
          </button>
        </div>
      `;
    }
  }

  function renderVideosSection(videos) {
    elements.videosGrid.innerHTML = '';

    if (videos.length === 0) {
      elements.videosGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 24px;">
          لا توجد مقاطع فيديو مسجلة لهذا المريض حتى الآن.
        </div>
      `;
      return;
    }

    videos.forEach((video) => {
      const card = document.createElement('div');
      card.className = 'video-item-card';
      card.innerHTML = `
        <div class="video-title" title="${video.title || video.original_name}">
          🎬 ${video.title || video.original_name}
        </div>
        <div class="video-meta">
          <div>الحجم: ${formatBytes(video.file_size)}</div>
          <div>تاريخ الرفع: ${formatDate(video.created_at)}</div>
        </div>
        <div style="display: flex; gap: 8px; margin-top: auto;">
          <button class="btn btn-sm btn-primary" style="flex: 1;" onclick="window.clinicApp.playVideo(${video.id}, '${escapeHtml(video.title || video.original_name)}')">
            تشغيل الفيديو
          </button>
          <button class="btn btn-sm btn-danger-outline" onclick="window.clinicApp.deleteVideo(${video.id})">
            حذف
          </button>
        </div>
      `;
      elements.videosGrid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  /* ==========================================================================
     PDF Document Operations
     ========================================================================== */

  function triggerUploadPdf(docType) {
    state.pendingDocUploadType = docType;
    elements.hiddenPdfInput.value = '';
    elements.hiddenPdfInput.click();
  }

  elements.hiddenPdfInput.addEventListener('change', async () => {
    const file = elements.hiddenPdfInput.files[0];
    if (!file || !state.pendingDocUploadType || !state.selectedPatientId) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('يجب اختيار ملف بصيغة PDF فقط', 'danger');
      return;
    }

    const docType = state.pendingDocUploadType;
    const docName = DOC_TITLES[docType] || docType;
    showToast(`جاري رفع ${docName}...`);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/patients/${state.selectedPatientId}/documents/${docType}?clientId=${state.clientId}`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload document');

      showToast(`تم رفع ${docName} بنجاح`);
      openPatientDetails(state.selectedPatientId, false);
      loadStats();
    } catch (err) {
      showToast(err.message || 'خطأ أثناء رفع الملف', 'danger');
    }
  });

  async function deletePdf(docType) {
    if (!state.selectedPatientId) return;
    const docName = DOC_TITLES[docType] || docType;

    const ok = confirm(`هل أنت متأكد من حذف ${docName}؟`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/patients/${state.selectedPatientId}/documents/${docType}?clientId=${state.clientId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete document');

      showToast(`تم حذف ${docName} بنجاح`);
      openPatientDetails(state.selectedPatientId, false);
      loadStats();
    } catch (err) {
      showToast('خطأ أثناء حذف الملف', 'danger');
    }
  }

  function viewPdf(docType) {
    if (!state.selectedPatientId) return;
    const docName = DOC_TITLES[docType] || docType;

    const url = `/api/patients/${state.selectedPatientId}/documents/${docType}`;
    elements.pdfViewerTitle.textContent = `${docName} - ${state.selectedPatientDetails?.full_name}`;
    elements.pdfIframe.src = url;
    elements.btnPdfDownload.href = `${url}?download=1`;

    openModal(elements.modalPdfViewer);
  }

  /* ==========================================================================
     Video Upload, Streaming & Delete
     ========================================================================== */

  elements.btnUploadVideoTrigger.addEventListener('click', () => {
    elements.inputVideoFile.value = '';
    elements.inputVideoFile.click();
  });

  elements.inputVideoFile.addEventListener('change', () => {
    const file = elements.inputVideoFile.files[0];
    if (!file || !state.selectedPatientId) return;

    const defaultTitle = file.name.replace(/\.[^/.]+$/, '');
    const title = prompt('أدخل وصفاً أو عنواناً لهذا الفيديو:', defaultTitle) || defaultTitle;

    uploadVideoWithProgress(file, title);
  });

  function uploadVideoWithProgress(file, title) {
    const patientId = state.selectedPatientId;
    const xhr = new XMLHttpRequest();

    elements.videoUploadFilename.textContent = `جاري رفع: ${file.name} (${formatBytes(file.size)})`;
    elements.videoUploadPercentage.textContent = '0%';
    elements.videoUploadProgressBar.style.width = '0%';
    elements.videoUploadProgressContainer.classList.remove('hidden');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        elements.videoUploadPercentage.textContent = `${percent}%`;
        elements.videoUploadProgressBar.style.width = `${percent}%`;
      }
    };

    xhr.onload = () => {
      elements.videoUploadProgressContainer.classList.add('hidden');
      if (xhr.status >= 200 && xhr.status < 300) {
        showToast('تم رفع الفيديو بنجاح');
        openPatientDetails(patientId, false);
        loadStats();
      } else {
        showToast('فشل في رفع الفيديو', 'danger');
      }
    };

    xhr.onerror = () => {
      elements.videoUploadProgressContainer.classList.add('hidden');
      showToast('حدث خطأ في الاتصال أثناء رفع الفيديو', 'danger');
    };

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);

    xhr.open('POST', `/api/patients/${patientId}/videos?clientId=${state.clientId}`);
    xhr.send(formData);
  }

  function playVideo(videoId, title) {
    if (!state.selectedPatientId) return;
    const streamUrl = `/api/patients/${state.selectedPatientId}/videos/${videoId}/stream`;

    elements.videoPlayerTitle.textContent = `مشاهدة فيديو: ${title}`;
    elements.html5VideoPlayer.src = streamUrl;
    openModal(elements.modalVideoPlayer);
    elements.html5VideoPlayer.play().catch(() => {});
  }

  async function deleteVideo(videoId) {
    if (!state.selectedPatientId) return;
    const ok = confirm('هل أنت متأكد من حذف هذا الفيديو نهائياً؟');
    if (!ok) return;

    try {
      const res = await fetch(`/api/patients/${state.selectedPatientId}/videos/${videoId}?clientId=${state.clientId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete video');

      showToast('تم حذف الفيديو بنجاح');
      openPatientDetails(state.selectedPatientId, false);
      loadStats();
    } catch (err) {
      showToast('خطأ أثناء حذف الفيديو', 'danger');
    }
  }

  /* ==========================================================================
     Print Patient Summary Sheet
     ========================================================================== */

  function printPatientCard(p) {
    let printFrame = document.getElementById('clinic-print-iframe');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'clinic-print-iframe';
      printFrame.style.position = 'fixed';
      printFrame.style.right = '0';
      printFrame.style.bottom = '0';
      printFrame.style.width = '0';
      printFrame.style.height = '0';
      printFrame.style.border = 'none';
      printFrame.style.visibility = 'hidden';
      document.body.appendChild(printFrame);
    }

    const hasSep = p.documents?.separate_file_name ? 'نعم (مرفوع)' : 'لا';
    const hasProg = p.documents?.program_file_name ? 'نعم (مرفوع)' : 'لا';
    const hasTests = p.documents?.tests_file_name ? 'نعم (مرفوع)' : 'لا';
    const hasBehav = p.documents?.behavioral_plan_file_name ? 'نعم (مرفوع)' : 'لا';
    const vCount = p.videos ? p.videos.length : 0;

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>كارت المريض - ${p.full_name}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Cairo', -apple-system, BlinkMacSystemFont, sans-serif;
          }
          body {
            color: #1e293b;
            background: #ffffff;
            padding: 20px;
            line-height: 1.5;
            direction: rtl;
          }
          .card-header {
            border-bottom: 2px solid #0284c7;
            padding-bottom: 14px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .card-title {
            font-size: 22px;
            font-weight: 800;
            color: #0369a1;
          }
          .clinic-sub {
            font-size: 13px;
            color: #64748b;
            margin-top: 3px;
          }
          .file-num-badge {
            font-size: 18px;
            font-weight: 800;
            border: 2px solid #0284c7;
            background: #f0f9ff;
            color: #0369a1;
            padding: 6px 16px;
            border-radius: 8px;
            letter-spacing: 1px;
          }
          .info-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          .info-table td {
            padding: 10px 14px;
            border: 1px solid #cbd5e1;
            font-size: 14px;
          }
          .info-table .label {
            background-color: #f8fafc;
            font-weight: 700;
            color: #334155;
            width: 22%;
          }
          .info-table .val {
            color: #0f172a;
          }
          .section-box {
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 14px 18px;
            margin-bottom: 18px;
            background: #ffffff;
          }
          .section-title {
            font-size: 14px;
            font-weight: 700;
            color: #0369a1;
            margin-bottom: 8px;
            border-bottom: 1px dashed #e2e8f0;
            padding-bottom: 6px;
          }
          .section-text {
            font-size: 13.5px;
            color: #334155;
            white-space: pre-wrap;
            line-height: 1.6;
          }
          .docs-list {
            list-style: none;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }
          .docs-item {
            font-size: 13px;
            color: #334155;
            padding: 6px 10px;
            background: #f8fafc;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
          }
          .docs-item strong {
            color: #0284c7;
          }
          .footer {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid #cbd5e1;
            padding-top: 16px;
            font-size: 13px;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="card-header">
          <div style="display: flex; align-items: center; gap: 16px;">
            ${p.photo_url ? `<img src="${p.photo_url}" style="width: 72px; height: 72px; border-radius: 8px; object-fit: cover; border: 2px solid #0284c7;" alt="صورة المريض">` : ''}
            <div>
              <h1 class="card-title">كارت بيانات المريض الطبي</h1>
              <div class="clinic-sub">منظومة سجلات العيادة الطبية</div>
            </div>
          </div>
          <div class="file-num-badge">${p.file_number}</div>
        </div>

        <table class="info-table">
          <tr>
            <td class="label">اسم المريض:</td>
            <td class="val" style="font-weight: 700; font-size: 15px;">${p.full_name}</td>
            <td class="label">النوع / العمر:</td>
            <td class="val">${p.gender === 'female' ? 'أنثى' : 'ذكر'} / ${p.age ? p.age + ' سنة' : '—'}</td>
          </tr>
          <tr>
            <td class="label">رقم الهاتف:</td>
            <td class="val">${p.phone || '—'}</td>
            <td class="label">الرقم القومي:</td>
            <td class="val">${p.national_id || '—'}</td>
          </tr>
          <tr>
            <td class="label">تاريخ التسجيل:</td>
            <td class="val" colspan="3">${formatDate(p.created_at)}</td>
          </tr>
        </table>

        <div class="section-box">
          <div class="section-title">التشخيص الطبي والحالة:</div>
          <div class="section-text">${p.diagnosis || 'لا يوجد تشخيص مسجل'}</div>
        </div>

        <div class="section-box">
          <div class="section-title">ملاحظات الطبيب:</div>
          <div class="section-text">${p.notes || 'لا توجد ملاحظات'}</div>
        </div>

        <div class="section-box">
          <div class="section-title">حالة الملفات والمرفقات:</div>
          <div class="docs-list">
            <div class="docs-item">ملف منفصل: <strong>${hasSep}</strong></div>
            <div class="docs-item">ملف برنامج: <strong>${hasProg}</strong></div>
            <div class="docs-item">ملف اختبارات: <strong>${hasTests}</strong></div>
            <div class="docs-item">ملف الخطة السلوكية: <strong>${hasBehav}</strong></div>
            <div class="docs-item" style="grid-column: span 2;">عدد مقاطع الفيديو: <strong>${vCount} مقطع</strong></div>
          </div>
        </div>

        <div class="footer">
          <div>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</div>
          <div>توقيع واعتماد الطبيب المعالج: .................................</div>
        </div>
      </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
    }, 300);
  }

  elements.btnPrintPatient.addEventListener('click', () => {
    const p = state.selectedPatientDetails;
    if (!p) return;
    printPatientCard(p);
  });

  /* ==========================================================================
     Database Backup
     ========================================================================== */

  /* ==========================================================================
     Database Backup & Restore Manager
     ========================================================================== */

  async function loadBackupsList() {
    if (!elements.backupListContainer) return;
    elements.backupListContainer.innerHTML = '<div class="backup-loading-state">جاري تحميل قائمة النسخ...</div>';

    try {
      const res = await fetch('/api/backups');
      if (!res.ok) throw new Error('Failed to fetch backups');
      const data = await res.json();
      const backups = data.backups || [];

      if (backups.length === 0) {
        elements.backupListContainer.innerHTML = '<div class="backup-empty-state">لا توجد نسخ احتياطية مسجلة حالياً على السيرفر</div>';
        return;
      }

      elements.backupListContainer.innerHTML = backups.map((b) => `
        <div class="backup-item">
          <div class="backup-item-info">
            <span class="backup-item-name">${b.fileName}</span>
            <span class="backup-item-meta">${formatDate(b.createdAt)} • ${formatBytes(b.fileSize)}</span>
          </div>
          <div class="backup-item-actions">
            <a href="${b.downloadUrl}" download="${b.fileName}" class="btn btn-sm btn-outline" title="تنزيل نسخة إلى جهازك">تنزيل</a>
            <button type="button" class="btn btn-sm btn-secondary btn-restore-backup" data-filename="${b.fileName}" title="استعادة هذه النسخة">استعادة</button>
          </div>
        </div>
      `).join('');

      // Attach restore handlers
      elements.backupListContainer.querySelectorAll('.btn-restore-backup').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const fileName = btn.getAttribute('data-filename');
          if (!fileName) return;

          const confirmed = window.confirm(
            `هل أنت متأكد من استعادة النسخة:\n(${fileName})؟\n\nتنبيه: سيقوم النظام بحفظ نسخة احترازية من الوضع الحالي تلقائياً قبل الاسترجاع.`
          );
          if (!confirmed) return;

          showToast('جاري استعادة قاعدة البيانات...');
          try {
            const restoreRes = await fetch('/api/backup/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName }),
            });
            const restoreData = await restoreRes.json();
            if (!restoreRes.ok) throw new Error(restoreData.error || 'Restore failed');

            showToast('تمت استعادة قاعدة البيانات بنجاح', 'success');
            closeModal(elements.modalBackupManager);
            loadStats();
            loadPatients();
          } catch (err) {
            showToast('تعذر استعادة قاعدة البيانات: ' + (err.message || 'خطأ غير معروف'), 'danger');
          }
        });
      });
    } catch (err) {
      elements.backupListContainer.innerHTML = '<div class="backup-empty-state">تعذر تحميل قائمة النسخ الاحتياطية</div>';
    }
  }

  // Open Backup Manager Modal
  elements.btnBackup.addEventListener('click', () => {
    openModal(elements.modalBackupManager);
    loadBackupsList();
  });

  // Create new instant backup button
  if (elements.btnCreateBackupNow) {
    elements.btnCreateBackupNow.addEventListener('click', async () => {
      showToast('جاري إنشاء نسخة احتياطية جديدة...');
      try {
        const res = await fetch('/api/backup', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Backup failed');

        showToast(`تم إنشاء النسخة الاحتياطية بنجاح (${formatBytes(data.fileSize)})`, 'success');
        loadBackupsList();
      } catch (err) {
        showToast('خطأ أثناء إنشاء النسخة الاحتياطية', 'danger');
      }
    });
  }

  // Upload and restore from external .db file
  if (elements.inputUploadBackup) {
    elements.inputUploadBackup.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const confirmed = window.confirm(
        `هل أنت متأكد من استعادة قاعدة البيانات من الملف المختار (${file.name})؟\n\nتنبيه: سيقوم النظام بحفظ نسخة احترازية أولاً.`
      );
      if (!confirmed) {
        elements.inputUploadBackup.value = '';
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      showToast('جاري رفع واستعادة ملف النسخة الاحتياطية...');
      try {
        const res = await fetch('/api/backup/upload-restore', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload restore failed');

        showToast('تم استعادة قاعدة البيانات من الملف المرفوع بنجاح', 'success');
        elements.inputUploadBackup.value = '';
        closeModal(elements.modalBackupManager);
        loadStats();
        loadPatients();
      } catch (err) {
        showToast('تعذر استعادة الملف: ' + (err.message || 'خطأ'), 'danger');
        elements.inputUploadBackup.value = '';
      }
    });
  }

  /* ==========================================================================
     Software Update Checker
     ========================================================================== */

  async function checkForAppUpdates() {
    try {
      const res = await fetch('/api/system/update');
      const data = await res.json();
      if (data && data.hasUpdate) {
        const badge = document.getElementById('update-available-badge');
        const text = document.getElementById('update-version-text');
        if (badge && text) {
          text.textContent = `تحديث ${data.latestVersion} متاح`;
          badge.style.display = 'inline-flex';
          badge.onclick = () => {
            showToast(`يتوفر إصدار أحدث (${data.latestVersion})! جارٍ فتح صفحة التحميل...`, 'info');
            if (data.htmlUrl) window.open(data.htmlUrl, '_blank');
          };
        }
      }
    } catch {
      // ignore
    }
  }

  /* ==========================================================================
     Global Handlers Exposure
     ========================================================================== */

  window.clinicApp = {
    triggerUploadPdf,
    deletePdf,
    viewPdf,
    playVideo,
    deleteVideo,
    dismissConflictBanner,
    forceRefreshPatient,
    checkForAppUpdates,
  };

  // Initialize
  initRealtimeEvents();
  loadNetworkInfo();
  loadStats();
  loadPatients();
  checkUrlForPatient();
  checkForAppUpdates();
});
