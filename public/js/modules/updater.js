// In-Place Application Auto-Update Controller Module

import { showToast } from '../utils.js';
import { openModal } from './modal.js';

let latestUpdateData = null;
let updatePollingTimer = null;

export async function checkForAppUpdates(elements) {
  try {
    const res = await fetch('/api/system/update');
    const data = await res.json();
    if (data && data.hasUpdate) {
      latestUpdateData = data;
      const badge = document.getElementById('update-available-badge');
      const text = document.getElementById('update-version-text');
      if (badge && text) {
        text.textContent = `تحديث ${data.latestVersion} متاح`;
        badge.style.display = 'inline-flex';
        badge.onclick = () => openUpdateModal(elements, data);
      }
    }
  } catch {
    // ignore
  }
}

export function openUpdateModal(elements, data) {
  if (!data) return;
  if (elements.updateCurrentVersionLabel) {
    elements.updateCurrentVersionLabel.textContent = data.currentVersion || '-';
  }
  if (elements.updateLatestVersionLabel) {
    elements.updateLatestVersionLabel.textContent = data.latestVersion;
  }
  if (elements.updateNotesContent) {
    elements.updateNotesContent.textContent = data.releaseNotes || 'تحسينات عامة في الأداء، واستقرار النظام، وإصلاحات برمجية.';
  }
  if (elements.btnUpdateViewGithub) {
    elements.btnUpdateViewGithub.href = data.htmlUrl || '#';
  }

  if (elements.updateProgressContainer) {
    elements.updateProgressContainer.classList.add('hidden');
  }
  if (elements.btnUpdateStart) {
    elements.btnUpdateStart.disabled = false;
    elements.btnUpdateStart.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      تثبيت التحديث وإعادة التشغيل تلقائياً
    `;
  }
  if (elements.btnUpdateCancel) {
    elements.btnUpdateCancel.disabled = false;
  }

  openModal(elements.modalAppUpdate);
}

export function initUpdater(elements) {
  if (!elements.btnUpdateStart) return;

  elements.btnUpdateStart.addEventListener('click', async () => {
    const confirmUpdate = confirm(
      'هل تريد بالتأكيد تثبيت التحديث الآن؟\n\nسيتم أخذ نسخة احتياطية تأمينية من البيانات تلقائياً، وتحديث ملفات البرنامج وإعادة تشغيله فوراً دون المساس بسجلات المرضى.'
    );
    if (!confirmUpdate) return;

    elements.btnUpdateStart.disabled = true;
    if (elements.btnUpdateCancel) elements.btnUpdateCancel.disabled = true;
    if (elements.updateProgressContainer) {
      elements.updateProgressContainer.classList.remove('hidden');
    }

    if (elements.updateProgressStatusText) {
      elements.updateProgressStatusText.textContent = 'جارٍ بدء عملية التحديث...';
    }
    if (elements.updateProgressPercentText) {
      elements.updateProgressPercentText.textContent = '5%';
    }
    if (elements.updateProgressFill) {
      elements.updateProgressFill.style.width = '5%';
    }

    try {
      const startRes = await fetch('/api/system/update/install', { method: 'POST' });
      const startData = await startRes.json();
      if (!startRes.ok) {
        throw new Error(startData.error || 'فشل بدء التحديث');
      }

      // Poll progress
      clearInterval(updatePollingTimer);
      updatePollingTimer = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/system/update/status');
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();

          if (elements.updateProgressStatusText) {
            elements.updateProgressStatusText.textContent = statusData.message;
          }
          if (elements.updateProgressPercentText) {
            elements.updateProgressPercentText.textContent = `${statusData.progress}%`;
          }
          if (elements.updateProgressFill) {
            elements.updateProgressFill.style.width = `${statusData.progress}%`;
          }

          if (statusData.status === 'ready') {
            clearInterval(updatePollingTimer);
            if (elements.updateProgressStatusText) {
              elements.updateProgressStatusText.textContent = '✅ تم تثبيت التحديث بنجاح! جارٍ إعادة تشغيل المنظومة...';
            }
            showToast('تم تثبيت التحديث بنجاح! جاري إعادة الاتصال بالخادم...', 'success');

            // Ping server until it comes back online, then reload page
            let retries = 0;
            const reconnectTimer = setInterval(async () => {
              retries++;
              try {
                const ping = await fetch('/api/stats', { cache: 'no-store' });
                if (ping.ok) {
                  clearInterval(reconnectTimer);
                  window.location.reload();
                }
              } catch {
                if (retries > 30) {
                  clearInterval(reconnectTimer);
                  window.location.reload();
                }
              }
            }, 1500);
          } else if (statusData.status === 'error') {
            clearInterval(updatePollingTimer);
            showToast(statusData.error || 'فشلت عملية التحديث', 'danger');
            elements.btnUpdateStart.disabled = false;
            if (elements.btnUpdateCancel) elements.btnUpdateCancel.disabled = false;
          }
        } catch {
          // Connection temporarily lost during restart
        }
      }, 600);
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء بدء التحديث', 'danger');
      elements.btnUpdateStart.disabled = false;
      if (elements.btnUpdateCancel) elements.btnUpdateCancel.disabled = false;
    }
  });
}
