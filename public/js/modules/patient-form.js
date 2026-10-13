/**
 * Clinic Patient Records - Patient Create/Edit Form Controller
 */

import { state } from '../state.js';
import { api } from '../api.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from '../utils.js';
import { openPhotoCropper } from './cropper.js';

let onPatientSaved = null;

export function initPatientForm(callbacks = {}) {
  onPatientSaved = callbacks.onPatientSaved;

  const form = document.getElementById('form-patient');
  const inputPhoto = document.getElementById('input-patient-photo');
  const btnRemovePhoto = document.getElementById('btn-remove-photo');
  const btnAdd = document.getElementById('btn-add-patient');
  const btnEmptyAdd = document.getElementById('btn-empty-add-patient');

  // Mark dirty on input change
  form?.querySelectorAll('input, select, textarea').forEach((input) => {
    input.addEventListener('input', () => {
      state.isEditFormDirty = true;
    });
  });

  // Photo file picker
  inputPhoto?.addEventListener('change', () => {
    const file = inputPhoto.files && inputPhoto.files[0];
    if (!file) return;
    openPhotoCropper(file, 'form');
    inputPhoto.value = '';
  });

  // Remove photo button
  btnRemovePhoto?.addEventListener('click', () => {
    state.pendingPhotoBase64 = null;
    state.removePhotoPending = true;
    state.isEditFormDirty = true;
    if (inputPhoto) inputPhoto.value = '';

    const img = document.getElementById('form-avatar-img');
    const placeholder = document.getElementById('form-avatar-placeholder');
    const label = document.getElementById('btn-photo-upload-label');

    if (img) {
      img.src = '';
      img.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    btnRemovePhoto.classList.add('hidden');
    if (label) label.textContent = 'اختيار صورة المريض';
  });

  // Top and empty state buttons trigger add modal
  btnAdd?.addEventListener('click', () => openAddPatientModal());
  btnEmptyAdd?.addEventListener('click', () => openAddPatientModal());

  // Save action targets
  document.getElementById('btn-save-patient')?.addEventListener('click', () => {
    if (!document.getElementById('patient-form-id')?.value) {
      state.saveActionTarget = 'upload';
    }
  });

  document.getElementById('btn-save-patient-only')?.addEventListener('click', () => {
    state.saveActionTarget = 'only';
  });

  // Form submit handler
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const idInput = document.getElementById('patient-form-id');
    const id = idInput?.value;
    const isEdit = Boolean(id);

    // Concurrent editing detection warning
    if (isEdit) {
      try {
        const viewersData = await api.getViewers(id, state.clientId);
        if (viewersData.viewersCount > 0) {
          const confirmSave = confirm(
            `⚠️ تنبيه: هذا الملف مفتوح حالياً على جهاز آخر.\n\nهل تريد المتابعة وحفظ التعديلات؟`
          );
          if (!confirmSave) return;
        }
      } catch { }
    }

    const genderSelect = document.getElementById('input-gender');
    if (!genderSelect?.value) {
      showToast('يرجى اختيار نوع المريض (ذكر أو أنثى)', 'warning');
      genderSelect?.focus();
      return;
    }

    const payload = {
      full_name: document.getElementById('input-full-name')?.value.trim(),
      file_number: document.getElementById('input-file-number')?.value.trim() || undefined,
      phone: document.getElementById('input-phone')?.value.trim() || undefined,
      national_id: document.getElementById('input-national-id')?.value.trim() || undefined,
      gender: genderSelect.value,
      age: document.getElementById('input-age')?.value ? parseInt(document.getElementById('input-age').value, 10) : undefined,
      birth_date: document.getElementById('input-birth-date')?.value || undefined,
      diagnosis: document.getElementById('input-diagnosis')?.value.trim() || undefined,
      notes: document.getElementById('input-notes')?.value.trim() || undefined,
      photo_base64: state.pendingPhotoBase64 || undefined,
      remove_photo: state.removePhotoPending || undefined,
    };

    try {
      const data = isEdit
        ? await api.updatePatient(id, payload, state.clientId)
        : await api.createPatient(payload);

      state.isEditFormDirty = false;
      resetFormAvatar(null);
      closeModal(document.getElementById('modal-patient'));

      if (onPatientSaved) {
        onPatientSaved(data, isEdit);
      }
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء حفظ المريض', 'danger');
    }
  });
}

export function resetFormAvatar(photoUrl = null) {
  state.pendingPhotoBase64 = null;
  state.removePhotoPending = false;

  const inputPhoto = document.getElementById('input-patient-photo');
  const img = document.getElementById('form-avatar-img');
  const placeholder = document.getElementById('form-avatar-placeholder');
  const btnRemove = document.getElementById('btn-remove-photo');
  const label = document.getElementById('btn-photo-upload-label');

  if (inputPhoto) inputPhoto.value = '';

  if (photoUrl) {
    if (img) {
      img.src = photoUrl;
      img.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');
    if (btnRemove) btnRemove.classList.remove('hidden');
    if (label) label.textContent = 'تغيير الصورة';
  } else {
    if (img) {
      img.src = '';
      img.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (btnRemove) btnRemove.classList.add('hidden');
    if (label) label.textContent = 'اختيار صورة المريض';
  }
}

export function openAddPatientModal() {
  const modal = document.getElementById('modal-patient');
  const title = document.getElementById('modal-patient-title');
  const idInput = document.getElementById('patient-form-id');
  const form = document.getElementById('form-patient');
  const gender = document.getElementById('input-gender');
  const saveText = document.getElementById('btn-save-patient-text');
  const saveOnlyBtn = document.getElementById('btn-save-patient-only');

  if (title) title.textContent = 'إضافة مريض جديد';
  if (idInput) idInput.value = '';
  if (form) form.reset();
  if (gender) gender.value = '';
  resetFormAvatar(null);

  state.isEditFormDirty = false;
  state.saveActionTarget = 'upload';
  if (saveText) saveText.textContent = 'الحفظ والانتقال لرفع الملفات ←';
  if (saveOnlyBtn) saveOnlyBtn.style.display = 'inline-flex';

  openModal(modal);
}

export async function openEditPatientModal(id) {
  try {
    const p = await api.getPatient(id);
    const modal = document.getElementById('modal-patient');

    document.getElementById('modal-patient-title').textContent = 'تعديل بيانات المريض';
    document.getElementById('patient-form-id').value = p.id;
    document.getElementById('input-full-name').value = p.full_name || '';
    document.getElementById('input-file-number').value = p.file_number || '';
    document.getElementById('input-phone').value = p.phone || '';
    document.getElementById('input-national-id').value = p.national_id || '';
    document.getElementById('input-gender').value = p.gender === 'female' ? 'female' : 'male';
    document.getElementById('input-age').value = p.age !== null ? p.age : '';
    document.getElementById('input-birth-date').value = p.birth_date || '';
    document.getElementById('input-diagnosis').value = p.diagnosis || '';
    document.getElementById('input-notes').value = p.notes || '';

    resetFormAvatar(p.photo_url || null);

    state.isEditFormDirty = false;
    state.saveActionTarget = 'save';
    const saveText = document.getElementById('btn-save-patient-text');
    const saveOnlyBtn = document.getElementById('btn-save-patient-only');
    if (saveText) saveText.textContent = 'حفظ التعديلات';
    if (saveOnlyBtn) saveOnlyBtn.style.display = 'none';

    openModal(modal);
  } catch (err) {
    showToast('خطأ في تحميل بيانات المريض: ' + err.message, 'danger');
  }
}
