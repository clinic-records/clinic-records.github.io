/**
 * Clinic Patient Records - Real-time SSE, Presence & Connection Watcher
 */

import { state } from '../state.js';
import { showToast } from '../utils.js';

let wasDisconnected = false;
let disconnectTimer = null;
let isServerUpdating = false;

export function initRealtimeEvents(callbacks = {}) {
  const onPatientsListChanged = callbacks.onPatientsListChanged || callbacks.onRefreshRequested;
  const onPatientUpdated = callbacks.onPatientUpdated;
  const onReconnected = callbacks.onReconnected;

  if (state.sseSource) {
    state.sseSource.close();
  }

  const sse = new EventSource(`/api/realtime?clientId=${state.clientId}`);
  state.sseSource = sse;

  sse.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 1. Connection recovery detection
      if (wasDisconnected) {
        clearTimeout(disconnectTimer);
        wasDisconnected = false;
        hideConnectionLostBanner();

        if (!isServerUpdating) {
          showToast('🟢 تمت استعادة الاتصال بالخادم بنجاح!', 'success');
          if (typeof onReconnected === 'function') {
            onReconnected();
          } else if (typeof onPatientsListChanged === 'function') {
            onPatientsListChanged();
          }
        }
      }

      // 2. Server updating broadcast event
      if (data.type === 'server_updating') {
        isServerUpdating = true;
        showServerUpdatingBanner(data.message);
        
        // Lock update buttons in any open modal across all active clients
        const btnStart = document.getElementById('btn-update-start');
        const btnCancel = document.getElementById('btn-update-cancel');
        const progressBox = document.getElementById('update-progress-container');
        const progressStatus = document.getElementById('update-progress-status');
        if (btnStart) {
          btnStart.disabled = true;
          btnStart.textContent = 'جارٍ تطبيق التحديث على الخادم...';
        }
        if (btnCancel) {
          btnCancel.disabled = true;
        }
        if (progressBox) {
          progressBox.classList.remove('hidden');
        }
        if (progressStatus) {
          progressStatus.textContent = data.message || 'جارٍ تطبيق التحديث حالياً وإعادة التشغيل...';
        }
        
        pollServerUntilReadyAndReload();
        return;
      }

      // 3. Presence count update
      if (data.type === 'presence' || data.type === 'connected') {
        const count = data.onlineUsers ?? data.onlineCount;
        const onlineCount = document.getElementById('online-users-count');
        const onlineBadge = document.getElementById('online-users-badge');
        if (onlineCount && count !== undefined) {
          onlineCount.textContent = count;
        }
        if (onlineBadge && count !== undefined) {
          onlineBadge.classList.toggle('hidden', count <= 1);
        }
      }

      // 4. Viewers on current patient changed
      if (data.type === 'patient_viewers_changed') {
        if (state.selectedPatientId && data.patientId === state.selectedPatientId) {
          updateViewersBadge(data.viewersCount);
          if (callbacks.onViewersUpdated) callbacks.onViewersUpdated(data.viewersCount);
        }
      }

      // 5. Patient modified by another client
      if (data.type === 'patient_updated') {
        if (typeof onPatientUpdated === 'function') {
          onPatientUpdated(data);
        } else if (state.selectedPatientId && data.patientId === state.selectedPatientId && data.updatedBy !== state.clientId) {
          showConflictBanner(data);
        }
      }

      // 6. Patients list created or deleted
      if (data.type === 'patients_list_changed') {
        if (typeof onPatientsListChanged === 'function') {
          onPatientsListChanged();
        }
      }
    } catch (err) {
      console.error('Error handling SSE message:', err);
    }
  };

  sse.onerror = () => {
    // Debounce brief reconnect attempts before alarming user
    if (!wasDisconnected && !isServerUpdating) {
      clearTimeout(disconnectTimer);
      disconnectTimer = setTimeout(() => {
        wasDisconnected = true;
        showConnectionLostBanner();
      }, 1200);
    }
  };
}

export function updateViewersBadge(count) {
  const badge = document.getElementById('detail-viewers-badge');
  if (!badge) return;
  const isMultiple = count > 1;
  badge.classList.toggle('hidden', !isMultiple);
  if (isMultiple) {
    badge.textContent = `👁️ مفتوح على ${count} أجهزة حالياً`;
  }
}

export function notifyViewingPatient(patientId) {
  if (!state.clientId) return;
  fetch('/api/realtime/viewing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: state.clientId, patientId }),
  }).catch(() => {});
}

export function stopViewingPatient() {
  if (!state.clientId) return;
  fetch('/api/realtime/viewing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: state.clientId, patientId: null }),
  }).catch(() => {});
}

export function showConflictBanner(event) {
  const container = document.getElementById('patient-conflict-alert-container');
  if (!container) return;

  const targetName = {
    details: 'البيانات الشخصية',
    document: 'أحد الملفات الطبية (PDF)',
    video: 'ملفات الفيديو والمشاهدات',
  }[event.action || event.target] || 'هذا السجل الطبي';

  container.innerHTML = `
    <div class="patient-conflict-banner">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:18px;">⚠️</span>
        <div>
          <strong>تنبيه: تم تعديل ${targetName} لهذا المريض للتو بواسطة مستخدم آخر!</strong>
          <div style="font-size:12px; opacity:0.85;">اضغط على تحديث الآن لتجنب الكتابة فوق بيانات حديثة.</div>
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm btn-primary" id="btn-conflict-refresh">
          تحديث البيانات الآن ↻
        </button>
        <button class="btn btn-sm btn-outline" id="btn-conflict-dismiss">
          تجاهل
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-conflict-refresh')?.addEventListener('click', () => {
    dismissConflictBanner();
    if (window.clinicApp?.forceRefreshPatient) {
      window.clinicApp.forceRefreshPatient();
    }
  });

  document.getElementById('btn-conflict-dismiss')?.addEventListener('click', () => {
    dismissConflictBanner();
  });
}

export function dismissConflictBanner() {
  const container = document.getElementById('patient-conflict-alert-container');
  if (container) container.innerHTML = '';
}

/* ==========================================================================
   Connection & Update Status Banners
   ========================================================================== */

function showConnectionLostBanner() {
  const existing = document.getElementById('connection-status-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'connection-status-banner';
  banner.className = 'connection-status-banner connection-lost';
  banner.innerHTML = `
    <div class="conn-banner-content">
      <span class="conn-pulse-dot red"></span>
      <span><strong>انقطع الاتصال بالخادم مؤقتاً</strong> — جارٍ إعادة الاتصال التلقائي، بياناتك المدخلة محفوظة في الشاشة...</span>
    </div>
  `;
  document.body.prepend(banner);
}

function hideConnectionLostBanner() {
  const banner = document.getElementById('connection-status-banner');
  if (banner) banner.remove();
}

function showServerUpdatingBanner(msg) {
  hideConnectionLostBanner();
  const existing = document.getElementById('server-updating-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'server-updating-banner';
  banner.className = 'connection-status-banner server-updating';
  banner.innerHTML = `
    <div class="conn-banner-content">
      <span class="conn-pulse-dot amber"></span>
      <span><strong>تنبيه تحديث المنظومة:</strong> ${msg || 'يجري تطبيق تحديث للمنظومة على الخادم وإعادة التشغيل (خلال ثوانٍ معدودة)... بياناتك محفوظة بأمان وسيتم تحديث الصفحة تلقائياً.'}</span>
    </div>
  `;
  document.body.prepend(banner);
}

function pollServerUntilReadyAndReload() {
  let retries = 0;
  const timer = setInterval(async () => {
    retries++;
    try {
      const ping = await fetch('/api/stats', { cache: 'no-store' });
      if (ping.ok) {
        clearInterval(timer);
        window.location.reload();
      }
    } catch {
      if (retries > 45) {
        clearInterval(timer);
        window.location.reload();
      }
    }
  }, 1200);
}
