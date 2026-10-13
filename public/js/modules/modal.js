/**
 * Clinic Patient Records - Modal Dialog Controller
 */

export function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

export function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  const anyOpen = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!anyOpen) {
    document.body.classList.remove('modal-open');
  }
}

export function attemptCloseModal(modalEl, isDirtyChecker) {
  if (!modalEl) return;
  if (isDirtyChecker && isDirtyChecker(modalEl)) {
    const confirmDiscard = window.confirm('لديك تعديلات غير محفوظة، هل أنت متأكد من الإغلاق والتراجع؟');
    if (!confirmDiscard) return;
  }
  closeModal(modalEl);
}

export function initModalListeners(isDirtyChecker) {
  // Close buttons with [data-close-modal]
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      const targetModal = document.getElementById(modalId);
      if (targetModal) attemptCloseModal(targetModal, isDirtyChecker);
    });
  });

  // Backdrop click closing
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) attemptCloseModal(backdrop, isDirtyChecker);
    });
  });

  // ESC key closing
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const topModal = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)')).pop();
      if (topModal) {
        attemptCloseModal(topModal, isDirtyChecker);
      }
    }
  });
}
