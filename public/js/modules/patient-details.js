/**
 * Clinic Patient Records - Patient Profile Details & Print Controller
 */

import { state, DOC_TITLES } from '../state.js';
import { api } from '../api.js';
import { openModal, closeModal } from './modal.js';
import { formatDate, formatBytes, showToast, escapeHtml } from '../utils.js';
import { notifyViewingPatient, updateViewersBadge, dismissConflictBanner } from './realtime.js';
import { renderVideosSection } from './videos.js';
import { openPhotoCropper } from './cropper.js';

let onPatientEditRequested = null;
let onPatientRefreshRequested = null;

export function initPatientDetails(callbacks = {}) {
  onPatientEditRequested = callbacks.onPatientEditRequested;
  onPatientRefreshRequested = callbacks.onPatientRefreshRequested;

  const btnEdit = document.getElementById('btn-edit-patient-details');
  const btnAddAnother = document.getElementById('btn-details-add-another');
  const btnPrint = document.getElementById('btn-print-patient');
  const btnShare = document.getElementById('btn-copy-patient-link');
  const btnChangePhoto = document.getElementById('btn-change-detail-photo');
  const inputDetailPhoto = document.getElementById('input-detail-photo');
  const detailAvatarWrap = document.getElementById('detail-avatar-wrap');
  const btnDeletePhotoFromViewer = document.getElementById('btn-delete-photo-from-viewer');
  const hiddenPdfInput = document.getElementById('hidden-pdf-input');

  btnEdit?.addEventListener('click', () => {
    if (state.selectedPatientId && onPatientEditRequested) {
      onPatientEditRequested(state.selectedPatientId);
    }
  });

  btnAddAnother?.addEventListener('click', () => {
    closeModal(document.getElementById('modal-patient-details'));
    document.getElementById('btn-add-patient')?.click();
  });

  btnPrint?.addEventListener('click', () => {
    if (state.selectedPatientDetails) {
      printPatientCard(state.selectedPatientDetails);
    }
  });

  btnShare?.addEventListener('click', () => {
    if (state.selectedPatientDetails) {
      openShareModal(state.selectedPatientDetails);
    }
  });

  // Photo viewer lightbox
  detailAvatarWrap?.addEventListener('click', () => {
    const p = state.selectedPatientDetails;
    if (p && p.photo_url) {
      const viewerImg = document.getElementById('photo-viewer-img');
      const viewerTitle = document.getElementById('photo-viewer-title');
      if (viewerImg) viewerImg.src = p.photo_url;
      if (viewerTitle) viewerTitle.textContent = `صورة المريض - ${p.full_name}`;
      openModal(document.getElementById('modal-photo-viewer'));
    }
  });

  // Change photo button
  btnChangePhoto?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (inputDetailPhoto) {
      inputDetailPhoto.value = '';
      inputDetailPhoto.click();
    }
  });

  inputDetailPhoto?.addEventListener('change', () => {
    const file = inputDetailPhoto.files && inputDetailPhoto.files[0];
    if (!file || !state.selectedPatientId) return;
    openPhotoCropper(file, 'detail');
    inputDetailPhoto.value = '';
  });

  // Delete photo from lightbox
  btnDeletePhotoFromViewer?.addEventListener('click', async () => {
    if (!state.selectedPatientId) return;
    const confirmDelete = confirm('هل أنت متأكد من رغبتك في حذف صورة هذا المريض؟');
    if (!confirmDelete) return;

    try {
      await api.deletePhoto(state.selectedPatientId);
      showToast('تم حذف صورة المريض بنجاح', 'success');
      closeModal(document.getElementById('modal-photo-viewer'));
      openPatientDetails(state.selectedPatientId, false);
      if (onPatientRefreshRequested) onPatientRefreshRequested();
    } catch (err) {
      showToast('فشل حذف الصورة: ' + err.message, 'danger');
    }
  });

  // Hidden PDF input listener for document uploads
  hiddenPdfInput?.addEventListener('change', async () => {
    const file = hiddenPdfInput.files && hiddenPdfInput.files[0];
    if (!file || !state.selectedPatientId || !state.pendingDocUploadType) return;

    if (file.type !== 'application/pdf') {
      showToast('يرجى اختيار ملف PDF صالح فقط', 'warning');
      return;
    }

    try {
      showToast('جارٍ رفع ملف PDF...', 'info');
      await api.uploadDocument(state.selectedPatientId, state.pendingDocUploadType, file, state.clientId);
      showToast('تم رفع الملف بنجاح', 'success');
      openPatientDetails(state.selectedPatientId, false);
      if (onPatientRefreshRequested) onPatientRefreshRequested();
    } catch (err) {
      showToast(err.message || 'فشل رفع الملف', 'danger');
    } finally {
      hiddenPdfInput.value = '';
      state.pendingDocUploadType = null;
    }
  });

  // URL Hash routing listener
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.patientId) {
      openPatientDetails(e.state.patientId, false);
    } else if (!window.location.hash.includes('patient=')) {
      const modal = document.getElementById('modal-patient-details');
      if (modal && !modal.classList.contains('hidden')) {
        closeModal(modal);
      }
    }
  });
}

export async function openPatientDetails(id, updateUrl = true) {
  try {
    const p = await api.getPatient(id);
    state.selectedPatientId = p.id;
    state.selectedPatientDetails = p;

    if (updateUrl) {
      history.pushState({ patientId: id }, '', `#patient=${id}`);
    }

    notifyViewingPatient(p.id);

    api.getViewers(p.id, state.clientId)
      .then((v) => updateViewersBadge(v.viewersCount))
      .catch(() => {});

    dismissConflictBanner();

    // Populate header avatar
    const firstChar = (p.full_name || '').trim().charAt(0) || 'م';
    const fallbackClass = p.gender === 'female' ? 'avatar-female' : 'avatar-male';
    const fallbackEl = document.getElementById('detail-avatar-fallback');
    const imgEl = document.getElementById('detail-avatar-img');
    const wrapEl = document.getElementById('detail-avatar-wrap');

    if (fallbackEl) {
      fallbackEl.textContent = firstChar;
      fallbackEl.className = `patient-avatar-fallback ${fallbackClass}`;
    }

    if (p.photo_url) {
      if (imgEl) {
        imgEl.src = p.photo_url;
        imgEl.classList.remove('hidden');
      }
      if (fallbackEl) fallbackEl.classList.add('hidden');
      if (wrapEl) {
        wrapEl.style.cursor = 'pointer';
        wrapEl.title = 'انقر لتكبير صورة المريض';
      }
    } else {
      if (imgEl) {
        imgEl.src = '';
        imgEl.classList.add('hidden');
      }
      if (fallbackEl) fallbackEl.classList.remove('hidden');
      if (wrapEl) {
        wrapEl.style.cursor = 'default';
        wrapEl.title = 'لا توجد صورة شخصية للمريض (انقر على الكاميرا لإضافة صورة)';
      }
    }

    // Header info
    document.getElementById('detail-file-number').textContent = p.file_number;
    document.getElementById('detail-full-name').textContent = p.full_name;

    const genderText = p.gender === 'female' ? 'أنثى' : 'ذكر';
    const ageText = p.age ? `${p.age} سنة` : 'العمر غير مسجل';
    const phoneText = p.phone ? `هاتف: ${p.phone}` : 'بدون هاتف';
    const dateText = `تاريخ التسجيل: ${formatDate(p.created_at)}`;

    document.getElementById('detail-meta-row').innerHTML = `
      <span>${genderText}</span>
      <span>•</span>
      <span>${ageText}</span>
      <span>•</span>
      <span>${phoneText}</span>
      <span>•</span>
      <span>${dateText}</span>
    `;

    document.getElementById('detail-diagnosis').textContent = p.diagnosis || 'لا يوجد تشخيص مسجل حالياً';
    document.getElementById('detail-notes').textContent = p.notes || 'لا توجد ملاحظات مسجلة';

    // 4 Fixed Document Cards
    renderDocCard('separate', document.getElementById('body-doc-separate'), p.documents?.separate_file_name, p.documents?.separate_file_size, p.documents?.separate_updated_at);
    renderDocCard('program', document.getElementById('body-doc-program'), p.documents?.program_file_name, p.documents?.program_file_size, p.documents?.program_updated_at);
    renderDocCard('tests', document.getElementById('body-doc-tests'), p.documents?.tests_file_name, p.documents?.tests_file_size, p.documents?.tests_updated_at);
    renderDocCard('behavioral_plan', document.getElementById('body-doc-behavioral_plan'), p.documents?.behavioral_plan_file_name, p.documents?.behavioral_plan_file_size, p.documents?.behavioral_plan_updated_at);

    // Videos
    renderVideosSection(p.videos || []);

    // QR thumbnail
    const baseLan = state.networkInfo?.lanUrl || window.location.origin;
    const directUrl = `${baseLan}/#patient=${p.id}`;
    api.getQrCode(directUrl)
      .then((qrData) => {
        if (qrData?.qrCodeDataUrl && state.selectedPatientId === p.id) {
          const thumb = document.getElementById('btn-patient-qr-thumb');
          if (thumb) thumb.src = qrData.qrCodeDataUrl;
        }
      })
      .catch(() => {});

    openModal(document.getElementById('modal-patient-details'));
  } catch (err) {
    showToast('تعذر فتح الملف الطبي للمريض: ' + err.message, 'danger');
  }
}

export function renderDocCard(docType, containerEl, fileName, fileSize, updatedAt) {
  if (!containerEl) return;
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
          رفع الملف الآن
        </button>
      </div>
    `;
  }
}

export function openShareModal(p) {
  const baseLan = state.networkInfo?.lanUrl || window.location.origin;
  const directUrl = `${baseLan}/#patient=${p.id}`;

  const shareFileNum = document.getElementById('share-patient-file-number');
  if (shareFileNum) shareFileNum.textContent = p.file_number;

  const shareUrlEl = document.getElementById('share-patient-url');
  if (shareUrlEl) shareUrlEl.textContent = directUrl;

  api.getQrCode(directUrl).then((qrData) => {
    if (qrData?.qrCodeDataUrl) {
      const qrImg = document.getElementById('share-patient-qr-image');
      if (qrImg) qrImg.src = qrData.qrCodeDataUrl;
    }
  }).catch(() => {});

  const btnCopy = document.getElementById('btn-copy-share-url');
  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(directUrl)
        .then(() => showToast('تم نسخ رابط ملف المريض بنجاح', 'success'))
        .catch(() => showToast('تعذر نسخ الرابط', 'danger'));
    };
  }

  openModal(document.getElementById('modal-share-patient'));
}

export function printPatientCard(p) {
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

  const doc = printFrame.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>كارت المريض - ${escapeHtml(p.full_name)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        @page { size: A4 portrait; margin: 15mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Cairo', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { color: #1e293b; background: #ffffff; padding: 20px; line-height: 1.5; direction: rtl; }
        .card-header { border-bottom: 2px solid #0284c7; padding-bottom: 14px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
        .card-title { font-size: 22px; font-weight: 800; color: #0369a1; }
        .clinic-sub { font-size: 13px; color: #64748b; margin-top: 3px; }
        .file-num-badge { font-size: 18px; font-weight: 800; border: 2px solid #0284c7; background: #f0f9ff; color: #0369a1; padding: 6px 16px; border-radius: 8px; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        .info-table td { padding: 10px 14px; border: 1px solid #cbd5e1; font-size: 14px; }
        .info-table .label { background-color: #f8fafc; font-weight: 700; color: #334155; width: 22%; }
        .info-table .val { color: #0f172a; }
        .section-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; }
        .section-title { font-size: 14px; font-weight: 700; color: #0369a1; margin-bottom: 8px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px; }
        .section-text { font-size: 13.5px; color: #334155; white-space: pre-wrap; line-height: 1.6; }
        .docs-list { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .docs-item { font-size: 13px; color: #334155; padding: 6px 10px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
        .docs-item strong { color: #0284c7; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #cbd5e1; padding-top: 16px; font-size: 13px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="card-header">
        <div style="display: flex; align-items: center; gap: 16px;">
          ${p.photo_url ? `<img src="${p.photo_url}" style="width: 86px; height: 86px; border-radius: 8px; object-fit: cover; border: 2px solid #0284c7;" alt="صورة المريض">` : ''}
          <div>
            <h1 class="card-title">كارت بيانات المريض الطبي</h1>
            <div class="clinic-sub">منظومة سجلات العيادة الطبية</div>
          </div>
        </div>
        <div class="file-num-badge">${escapeHtml(p.file_number)}</div>
      </div>

      <table class="info-table">
        <tr>
          <td class="label">اسم المريض:</td>
          <td class="val" style="font-weight: 700; font-size: 15px;">${escapeHtml(p.full_name)}</td>
          <td class="label">النوع / العمر:</td>
          <td class="val">${p.gender === 'female' ? 'أنثى' : 'ذكر'} / ${p.age ? p.age + ' سنة' : '—'}</td>
        </tr>
        <tr>
          <td class="label">رقم الهاتف:</td>
          <td class="val">${escapeHtml(p.phone || '—')}</td>
          <td class="label">الرقم القومي:</td>
          <td class="val">${escapeHtml(p.national_id || '—')}</td>
        </tr>
        <tr>
          <td class="label">تاريخ التسجيل:</td>
          <td class="val" colspan="3">${formatDate(p.created_at)}</td>
        </tr>
      </table>

      <div class="section-box">
        <div class="section-title">التشخيص الطبي والحالة:</div>
        <div class="section-text">${escapeHtml(p.diagnosis || 'لا يوجد تشخيص مسجل')}</div>
      </div>

      <div class="section-box">
        <div class="section-title">ملاحظات الطبيب:</div>
        <div class="section-text">${escapeHtml(p.notes || 'لا توجد ملاحظات')}</div>
      </div>

      <div class="section-box">
        <div class="section-title">حالة الملفات والمرفقات:</div>
        <div class="docs-list">
          <div class="docs-item">ملف منفصل: <strong>${hasSep}</strong></div>
          <div class="docs-item">ملف برنامج: <strong>${hasProg}</strong></div>
          <div class="docs-item">ملف اختبارات: <strong>${hasTests}</strong></div>
          <div class="docs-item">الخطة السلوكية: <strong>${hasBehav}</strong></div>
        </div>
      </div>

      <div class="footer">
        <div>تاريخ الطباعة: ${formatDate(new Date().toISOString())}</div>
        <div>منظومة إدارة ملفات وسجلات العيادة الطبية</div>
      </div>
    </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 400);
}

export function checkUrlForPatient() {
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

export function triggerUploadPdf(docType) {
  state.pendingDocUploadType = docType;
  const hiddenPdfInput = document.getElementById('hidden-pdf-input');
  if (hiddenPdfInput) {
    hiddenPdfInput.value = '';
    hiddenPdfInput.click();
  }
}

export async function deletePdf(docType) {
  if (!state.selectedPatientId) return;
  const docName = DOC_TITLES[docType] || docType;
  const ok = confirm(`هل أنت متأكد من حذف ${docName}؟`);
  if (!ok) return;

  try {
    await api.deleteDocument(state.selectedPatientId, docType, state.clientId);
    showToast(`تم حذف ${docName} بنجاح`, 'success');
    openPatientDetails(state.selectedPatientId, false);
    if (onPatientRefreshRequested) onPatientRefreshRequested();
  } catch (err) {
    showToast('خطأ أثناء حذف الملف: ' + err.message, 'danger');
  }
}

export function viewPdf(docType) {
  if (!state.selectedPatientId) return;
  const docName = DOC_TITLES[docType] || docType;
  const url = `/api/patients/${state.selectedPatientId}/documents/${docType}`;

  const titleEl = document.getElementById('pdf-viewer-title');
  const iframeEl = document.getElementById('pdf-iframe');
  const downloadBtn = document.getElementById('btn-pdf-download');

  if (titleEl) titleEl.textContent = `${docName} - ${state.selectedPatientDetails?.full_name || ''}`;
  if (iframeEl) iframeEl.src = url;
  if (downloadBtn) downloadBtn.href = `${url}?download=1`;

  openModal(document.getElementById('modal-pdf-viewer'));
}
