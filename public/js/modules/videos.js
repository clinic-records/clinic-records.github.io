/**
 * Clinic Patient Records - Patient Videos Controller
 */

import { state } from '../state.js';
import { api } from '../api.js';
import { openModal, closeModal } from './modal.js';
import { formatDate, formatBytes, showToast, escapeHtml } from '../utils.js';

let onVideoChanged = null;

export function initVideos(callbacks = {}) {
  onVideoChanged = callbacks.onVideoChanged;

  const btnUpload = document.getElementById('btn-upload-video-trigger');
  const inputFile = document.getElementById('input-video-file');

  btnUpload?.addEventListener('click', () => {
    if (inputFile) {
      inputFile.value = '';
      inputFile.click();
    }
  });

  inputFile?.addEventListener('change', async () => {
    const file = inputFile.files && inputFile.files[0];
    if (!file || !state.selectedPatientId) return;

    if (!file.type.startsWith('video/')) {
      showToast('يرجى اختيار ملف فيديو صالح فقط', 'warning');
      return;
    }

    const progressContainer = document.getElementById('video-upload-progress-container');
    const filenameEl = document.getElementById('video-upload-filename');
    const percentEl = document.getElementById('video-upload-percentage');
    const progressBar = document.getElementById('video-upload-progress-bar');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (filenameEl) filenameEl.textContent = file.name;
    if (percentEl) percentEl.textContent = '0%';
    if (progressBar) progressBar.style.width = '0%';

    try {
      await api.uploadVideo(state.selectedPatientId, file, state.clientId, (percent) => {
        if (percentEl) percentEl.textContent = `${percent}%`;
        if (progressBar) progressBar.style.width = `${percent}%`;
      });

      showToast('تم رفع الفيديو بنجاح', 'success');
      if (onVideoChanged) onVideoChanged();
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء رفع الفيديو', 'danger');
    } finally {
      if (progressContainer) progressContainer.classList.add('hidden');
      inputFile.value = '';
    }
  });
}

export function renderVideosSection(videos = []) {
  const grid = document.getElementById('videos-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (videos.length === 0) {
    grid.innerHTML = `
      <div class="empty-videos-notice" style="grid-column: 1 / -1; text-align: center; padding: 24px 16px; color: var(--text-muted); background: var(--bg-hover); border-radius: var(--radius-sm); border: 1px dashed var(--border-color);">
        لا توجد فيديوهات مسجلة لهذا المريض حتى الآن. اضغط على "رفع فيديو جديد" لإضافة تسجيل للجلسة.
      </div>
    `;
    return;
  }

  videos.forEach((v) => {
    const card = document.createElement('div');
    card.className = 'video-item-card';

    card.innerHTML = `
      <div class="video-thumbnail-placeholder" onclick="window.clinicApp.playVideo('/api/videos/${v.id}', '${escapeHtml(v.original_name)}')">
        <div class="video-play-btn-circle">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
      </div>
      <div class="video-card-body">
        <div class="video-title" title="${escapeHtml(v.original_name)}">${escapeHtml(v.original_name)}</div>
        <div class="video-meta">
          <span>الحجم: ${formatBytes(v.file_size)}</span>
          <span>تاريخ الرفع: ${formatDate(v.created_at)}</span>
        </div>
        <div class="video-actions-row">
          <button class="btn btn-sm btn-primary" onclick="window.clinicApp.playVideo('/api/videos/${v.id}', '${escapeHtml(v.original_name)}')">
            تشغيل الفيديو
          </button>
          <button class="btn btn-sm btn-danger-outline" onclick="window.clinicApp.deleteVideo(${v.id})">
            حذف
          </button>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

export function playVideo(streamUrl, title) {
  const modal = document.getElementById('modal-video-player');
  const titleEl = document.getElementById('video-player-title');
  const player = document.getElementById('html5-video-player');

  if (titleEl) titleEl.textContent = title;
  if (player) {
    player.src = streamUrl;
    player.load();
    player.play().catch(() => {});
  }

  openModal(modal);
}

export async function deleteVideo(videoId) {
  if (!state.selectedPatientId || !videoId) return;
  const ok = confirm('هل أنت متأكد من حذف هذا الفيديو نهائياً؟');
  if (!ok) return;

  try {
    await api.deleteVideo(state.selectedPatientId, videoId, state.clientId);
    showToast('تم حذف الفيديو بنجاح', 'success');
    if (onVideoChanged) onVideoChanged();
  } catch (err) {
    showToast(err.message || 'فشل حذف الفيديو', 'danger');
  }
}
