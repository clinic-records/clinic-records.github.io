/**
 * Clinic Patient Records - Global State & Constants Store
 */

const clientId = sessionStorage.getItem('clinic_client_id') ||
  `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
sessionStorage.setItem('clinic_client_id', clientId);

export const state = {
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

export const DOC_TITLES = {
  separate: 'الملف المنفصل',
  program: 'ملف البرنامج',
  tests: 'ملف الاختبارات',
  behavioral_plan: 'الخطة السلوكية',
};
