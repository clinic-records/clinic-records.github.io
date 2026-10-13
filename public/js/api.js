/**
 * Clinic Patient Records - Unified REST API Client
 */

async function request(url, options = {}) {
  const res = await fetch(url, options);
  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = (typeof data === 'object' && data?.error) ? data.error : res.statusText || 'حدث خطأ في الاتصال بالخادم';
    throw new Error(errorMsg);
  }

  return data;
}

export const api = {
  // Stats & Network
  getStats: () => request('/api/stats'),
  getNetworkInfo: () => request('/api/network'),
  getQrCode: (text) => request(`/api/qrcode?text=${encodeURIComponent(text)}`),

  // Patients
  getPatients: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/patients${q ? `?${q}` : ''}`);
  },
  getPatient: (id) => request(`/api/patients/${id}`),
  createPatient: (payload) => request('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  updatePatient: (id, payload, clientId) => request(`/api/patients/${id}${clientId ? `?clientId=${clientId}` : ''}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  deletePatient: (id, clientId) => request(`/api/patients/${id}${clientId ? `?clientId=${clientId}` : ''}`, {
    method: 'DELETE',
  }),
  restorePatient: (id) => request(`/api/patients/${id}/restore`, {
    method: 'POST',
  }),
  permanentDeletePatient: (id) => request(`/api/patients/${id}/permanent`, {
    method: 'DELETE',
  }),
  emptyRecycleBin: () => request('/api/patients/recycle-bin/empty', {
    method: 'POST',
  }),

  // Patient Photo
  uploadPhoto: (id, bodyOrFormData) => {
    const isFormData = bodyOrFormData instanceof FormData;
    const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
    const body = isFormData ? bodyOrFormData : JSON.stringify(bodyOrFormData);
    return request(`/api/patients/${id}/photo`, {
      method: 'POST',
      headers,
      body,
    });
  },
  deletePhoto: (id) => request(`/api/patients/${id}/photo`, {
    method: 'DELETE',
  }),

  // Documents
  uploadDocument: (id, docType, file, clientId) => {
    const formData = new FormData();
    formData.append('document', file);
    return request(`/api/patients/${id}/documents/${docType}${clientId ? `?clientId=${clientId}` : ''}`, {
      method: 'POST',
      body: formData,
    });
  },
  deleteDocument: (id, docType, clientId) => request(`/api/patients/${id}/documents/${docType}${clientId ? `?clientId=${clientId}` : ''}`, {
    method: 'DELETE',
  }),

  // Videos
  uploadVideo: (id, file, clientId, onProgress) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `/api/patients/${id}/videos${clientId ? `?clientId=${clientId}` : ''}`;

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent, e.loaded, e.total);
        }
      });

      xhr.addEventListener('load', () => {
        try {
          const json = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || 'فشل رفع الفيديو'));
          }
        } catch {
          reject(new Error('خطأ غير متوقع أثناء الرفع'));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('فشل الاتصال بالشبكة')));
      xhr.addEventListener('abort', () => reject(new Error('تم إلغاء عملية الرفع')));

      const formData = new FormData();
      formData.append('video', file);

      xhr.open('POST', url, true);
      xhr.send(formData);
    });
  },
  deleteVideo: (id, videoId, clientId) => request(`/api/patients/${id}/videos/${videoId}${clientId ? `?clientId=${clientId}` : ''}`, {
    method: 'DELETE',
  }),

  // Presence & Viewers
  getViewers: (id, clientId) => request(`/api/patients/${id}/viewers?clientId=${clientId}`),
  notifyViewing: (id, clientId) => request(`/api/patients/${id}/viewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  }),
  stopViewing: (clientId) => request('/api/viewers', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  }),

  // Backups
  getBackups: () => request('/api/backups'),
  createBackup: () => request('/api/backups', { method: 'POST' }),
  restoreBackup: (filename) => request(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' }),
  deleteBackup: (filename) => request(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  uploadBackupFile: (file) => {
    const formData = new FormData();
    formData.append('backup', file);
    return request('/api/backups/upload', {
      method: 'POST',
      body: formData,
    });
  },
  openBackupsFolder: () => request('/api/system/open-backups-folder', { method: 'POST' }),

  // System Update
  checkUpdate: () => request('/api/system/update'),
  installUpdate: () => request('/api/system/update/install', { method: 'POST' }),
  getUpdateStatus: () => request('/api/system/update/status'),
};
