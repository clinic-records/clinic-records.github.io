/**
 * Clinic Patient Records - Patients Table & Batch Actions Controller
 */

import { state } from '../state.js';
import { formatDate, escapeHtml } from '../utils.js';

let onPatientSelected = null;
let onRestorePatient = null;
let onPermanentDelete = null;
let onBatchAction = null;

export function initTable(callbacks = {}) {
  onPatientSelected = callbacks.onPatientSelected;
  onRestorePatient = callbacks.onRestorePatient;
  onPermanentDelete = callbacks.onPermanentDelete;
  onBatchAction = callbacks.onBatchAction;

  const tableBody = document.getElementById('patients-table-body');
  const selectAll = document.getElementById('select-all-checkbox');

  if (tableBody) {
    tableBody.addEventListener('click', (e) => {
      // Checkbox click
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

      // Recycle restore action
      const restoreBtn = e.target.closest('button[data-action="recycle-restore"]');
      if (restoreBtn) {
        const id = parseInt(restoreBtn.getAttribute('data-id'), 10);
        if (onRestorePatient) onRestorePatient(id);
        return;
      }

      // Recycle permanent delete action
      const permBtn = e.target.closest('button[data-action="recycle-permanent"]');
      if (permBtn) {
        const id = parseInt(permBtn.getAttribute('data-id'), 10);
        if (onPermanentDelete) onPermanentDelete(id);
        return;
      }

      // Click on phone link -> don't open details modal
      if (e.target.closest('a')) return;

      // Click on row -> open details
      const row = e.target.closest('tr[data-patient-id]');
      if (row && onPatientSelected) {
        const id = parseInt(row.getAttribute('data-patient-id'), 10);
        onPatientSelected(id);
      }
    });
  }

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      if (selectAll.checked) {
        state.patients.forEach((p) => state.selectedPatientIds.add(p.id));
      } else {
        state.selectedPatientIds.clear();
      }
      renderPatientsTable();
    });
  }

  // Batch action buttons
  document.getElementById('btn-batch-cancel')?.addEventListener('click', () => {
    state.selectedPatientIds.clear();
    renderPatientsTable();
  });

  document.getElementById('btn-batch-delete')?.addEventListener('click', () => {
    if (onBatchAction) onBatchAction('delete');
  });

  document.getElementById('btn-tab-recycle-restore')?.addEventListener('click', () => {
    if (onBatchAction) onBatchAction('restore');
  });

  document.getElementById('btn-tab-recycle-permanent')?.addEventListener('click', () => {
    if (onBatchAction) onBatchAction('permanent');
  });
}

export function renderPatientsTable() {
  const tableBody = document.getElementById('patients-table-body');
  const tableEl = document.getElementById('patients-table-element');
  const emptyState = document.getElementById('empty-state');
  const paginationSection = document.getElementById('pagination-section');
  const resultsCountBadge = document.getElementById('results-count-badge');
  const activeTitle = document.getElementById('table-active-title');

  if (!tableBody) return;
  tableBody.innerHTML = '';
  const isRecycle = state.activeTab === 'recycle';

  if (activeTitle) {
    activeTitle.textContent = isRecycle ? 'سجلات سلة المحذوفات' : 'قائمة المرضى المسجلين';
  }
  if (resultsCountBadge) {
    resultsCountBadge.textContent = `${Number(state.totalPatients).toLocaleString('ar-EG')} مريض`;
  }

  const thDiag = document.getElementById('th-col-diag');
  const thDate = document.getElementById('th-col-date');
  if (thDiag) thDiag.textContent = isRecycle ? 'التشخيص / الحالة' : 'التشخيص';
  if (thDate) thDate.textContent = isRecycle ? 'تاريخ الحذف' : 'تاريخ التسجيل';
  document.getElementById('th-col-actions')?.classList.toggle('hidden', !isRecycle);
  document.getElementById('btn-empty-recycle-tab')?.classList.toggle('hidden', !isRecycle || state.totalPatients === 0);

  document.getElementById('btn-batch-delete')?.classList.toggle('hidden', isRecycle);
  document.getElementById('btn-tab-recycle-restore')?.classList.toggle('hidden', !isRecycle);
  document.getElementById('btn-tab-recycle-permanent')?.classList.toggle('hidden', !isRecycle);

  if (state.patients.length === 0) {
    tableEl?.classList.add('hidden');
    emptyState?.classList.remove('hidden');
    paginationSection?.classList.add('hidden');

    const emptyTitle = emptyState?.querySelector('h3');
    const emptyDesc = emptyState?.querySelector('p');
    if (emptyTitle) {
      emptyTitle.textContent = isRecycle ? 'سلة المحذوفات فارغة' : 'لا يوجد مرضى مسجلين حتى الآن';
    }
    if (emptyDesc) {
      emptyDesc.textContent = isRecycle
        ? 'لا توجد سجلات مرضى محذوفة حالياً.'
        : 'اضغط على زر "مريض جديد" لتسجيل مريض والبدء في حفظ بياناته وملفاته.';
    }
    document.getElementById('btn-empty-add-patient')?.classList.toggle('hidden', isRecycle);
    updateBatchToolbar();
    return;
  }

  tableEl?.classList.remove('hidden');
  emptyState?.classList.add('hidden');
  paginationSection?.classList.remove('hidden');

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

    const firstChar = (patient.full_name || '').trim().charAt(0) || 'م';
    const fallbackClass = patient.gender === 'female' ? 'avatar-female' : 'avatar-male';
    const avatarHtml = patient.photo_url
      ? `<img src="${patient.photo_url}" class="patient-avatar-img" alt="${escapeHtml(patient.full_name)}" loading="lazy">`
      : `<div class="patient-avatar-fallback ${fallbackClass}">${firstChar}</div>`;

    tr.innerHTML = `
      <td class="td-checkbox">
        <input type="checkbox" class="table-checkbox" data-patient-id="${patient.id}" ${isSelected ? 'checked' : ''} aria-label="تحديد المريض">
      </td>
      <td class="td-file"><span class="file-code-badge">${escapeHtml(patient.file_number)}</span></td>
      <td class="td-name">
        <div class="patient-name-cell">
          <div class="patient-avatar-wrap sm">
            ${avatarHtml}
          </div>
          <span class="patient-name-text">${escapeHtml(patient.full_name)}</span>
        </div>
      </td>
      <td class="td-phone">${patient.phone ? `<a href="tel:${patient.phone}" class="patient-phone-link">${escapeHtml(patient.phone)}</a>` : '—'}</td>
      <td class="td-gender-age">${genderBadge} / ${ageText}</td>
      <td class="td-diagnosis">${patient.diagnosis ? `<span title="${escapeHtml(patient.diagnosis)}">${escapeHtml(patient.diagnosis.substring(0, 32))}${patient.diagnosis.length > 32 ? '...' : ''}</span>` : '—'}</td>
      <td class="td-date">${dateText}</td>
      ${actionButtons}
    `;

    tableBody.appendChild(tr);
  });

  updateBatchToolbar();

  const paginationInfo = document.getElementById('pagination-info-text');
  const btnPrev = document.getElementById('btn-prev-page');
  const btnNext = document.getElementById('btn-next-page');

  if (paginationInfo) paginationInfo.textContent = `صفحة ${state.currentPage} من ${state.totalPages}`;
  if (btnPrev) btnPrev.disabled = state.currentPage <= 1;
  if (btnNext) btnNext.disabled = state.currentPage >= state.totalPages;
}

export function updateBatchToolbar() {
  const toolbar = document.getElementById('batch-actions-bar');
  const countBadge = document.getElementById('batch-selected-count');
  const selectAll = document.getElementById('select-all-checkbox');

  const count = state.selectedPatientIds.size;
  if (toolbar) toolbar.classList.toggle('hidden', count === 0);
  if (countBadge) countBadge.textContent = Number(count).toLocaleString('ar-EG');

  if (selectAll) {
    if (state.patients.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    } else {
      const allSelected = state.patients.every((p) => state.selectedPatientIds.has(p.id));
      const someSelected = state.patients.some((p) => state.selectedPatientIds.has(p.id));
      selectAll.checked = allSelected;
      selectAll.indeterminate = someSelected && !allSelected;
    }
  }
}
