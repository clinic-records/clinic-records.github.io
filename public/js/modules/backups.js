// Database Backup & Restore Manager Module

import { showToast, formatDate, formatBytes } from '../utils.js';
import { openModal, closeModal } from './modal.js';

export function initBackups(elements, { onRestoreSuccess } = {}) {
  if (!elements.btnBackup) return;

  // Open Backup Manager Modal
  elements.btnBackup.addEventListener('click', () => {
    openModal(elements.modalBackupManager);
    loadBackupsList(elements, onRestoreSuccess);
  });

  // Create new instant backup
  if (elements.btnCreateBackupNow) {
    elements.btnCreateBackupNow.addEventListener('click', async () => {
      showToast('جاري إنشاء نسخة احتياطية جديدة...');
      try {
        const res = await fetch('/api/backup', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Backup failed');

        showToast(`تم إنشاء النسخة الاحتياطية بنجاح (${formatBytes(data.fileSize)})`, 'success');
        loadBackupsList(elements, onRestoreSuccess);
      } catch (err) {
        showToast('خطأ أثناء إنشاء النسخة الاحتياطية: ' + (err.message || 'خطأ غير معروف'), 'danger');
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
        if (typeof onRestoreSuccess === 'function') {
          onRestoreSuccess();
        }
      } catch (err) {
        showToast('تعذر استعادة الملف: ' + (err.message || 'خطأ'), 'danger');
        elements.inputUploadBackup.value = '';
      }
    });
  }
}

export async function loadBackupsList(elements, onRestoreSuccess) {
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
          if (typeof onRestoreSuccess === 'function') {
            onRestoreSuccess();
          }
        } catch (err) {
          showToast('تعذر استعادة قاعدة البيانات: ' + (err.message || 'خطأ غير معروف'), 'danger');
        }
      });
    });
  } catch (err) {
    elements.backupListContainer.innerHTML = '<div class="backup-empty-state">تعذر تحميل قائمة النسخ الاحتياطية</div>';
  }
}
