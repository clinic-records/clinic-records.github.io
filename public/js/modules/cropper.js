/**
 * Clinic Patient Records - Interactive Face Cropper Module
 */

import { openModal, closeModal } from './modal.js';
import { showToast } from '../utils.js';

export const cropper = {
  image: null,
  target: null, // 'form' or 'detail'
  scale: 1,
  minScale: 1,
  maxScale: 4,
  x: 0,
  y: 0,
  rotation: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  cropRadius: 140, // 280px diameter circle on 340px canvas
  draw: null,
};

let onConfirmCallback = null;

export function initCropper(onConfirm) {
  onConfirmCallback = onConfirm;

  const canvas = document.getElementById('cropper-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const zoomRange = document.getElementById('cropper-zoom-range');
  const btnRotate = document.getElementById('btn-cropper-rotate');
  const btnReset = document.getElementById('btn-cropper-reset');
  const btnConfirm = document.getElementById('btn-cropper-confirm');

  function draw() {
    if (!cropper.image) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = cropper.cropRadius;

    ctx.clearRect(0, 0, w, h);

    // Background fill
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    // Transformed image
    ctx.save();
    ctx.translate(cx + cropper.x, cy + cropper.y);
    ctx.rotate((cropper.rotation * Math.PI) / 180);
    ctx.scale(cropper.scale, cropper.scale);

    const iw = cropper.image.width;
    const ih = cropper.image.height;
    ctx.drawImage(cropper.image, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();

    // Mask outside circle
    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 29, 0.78)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill();

    // Circular border
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#14b8a6';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Inner guide dashed circle
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  cropper.draw = draw;

  function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function onStart(e) {
    if (!cropper.image) return;
    cropper.isDragging = true;
    const pos = getCoords(e);
    cropper.startX = pos.x;
    cropper.startY = pos.y;
    cropper.originX = cropper.x;
    cropper.originY = cropper.y;
  }

  function onMove(e) {
    if (!cropper.isDragging) return;
    if (e.cancelable) e.preventDefault();
    const pos = getCoords(e);
    cropper.x = cropper.originX + (pos.x - cropper.startX);
    cropper.y = cropper.originY + (pos.y - cropper.startY);
    draw();
  }

  function onEnd() {
    cropper.isDragging = false;
  }

  canvas.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);

  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);

  // Wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const nextScale = Math.min(cropper.maxScale, Math.max(cropper.minScale, cropper.scale + delta));
    cropper.scale = nextScale;
    if (zoomRange) zoomRange.value = nextScale.toFixed(2);
    draw();
  }, { passive: false });

  // Slider zoom
  if (zoomRange) {
    zoomRange.addEventListener('input', () => {
      cropper.scale = parseFloat(zoomRange.value);
      draw();
    });
  }

  // Rotate button
  if (btnRotate) {
    btnRotate.addEventListener('click', () => {
      cropper.rotation = (cropper.rotation + 90) % 360;
      draw();
    });
  }

  // Reset button
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      cropper.x = 0;
      cropper.y = 0;
      cropper.rotation = 0;
      cropper.scale = cropper.minScale;
      if (zoomRange) zoomRange.value = cropper.minScale.toFixed(2);
      draw();
    });
  }

  // Confirm button
  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (!cropper.image) return;

      const outSize = 512;
      const outCanvas = document.createElement('canvas');
      outCanvas.width = outSize;
      outCanvas.height = outSize;
      const outCtx = outCanvas.getContext('2d');

      const outCenter = outSize / 2;
      const scaleRatio = (outSize / 2) / cropper.cropRadius;

      outCtx.fillStyle = '#ffffff';
      outCtx.fillRect(0, 0, outSize, outSize);

      outCtx.save();
      outCtx.translate(outCenter + cropper.x * scaleRatio, outCenter + cropper.y * scaleRatio);
      outCtx.rotate((cropper.rotation * Math.PI) / 180);
      outCtx.scale(cropper.scale * scaleRatio, cropper.scale * scaleRatio);

      const iw = cropper.image.width;
      const ih = cropper.image.height;
      outCtx.drawImage(cropper.image, -iw / 2, -ih / 2, iw, ih);
      outCtx.restore();

      const croppedBase64 = outCanvas.toDataURL('image/jpeg', 0.92);

      const modalCropper = document.getElementById('modal-photo-cropper');
      closeModal(modalCropper);

      if (typeof onConfirmCallback === 'function') {
        onConfirmCallback(croppedBase64, cropper.target);
      } else if (onConfirmCallback && typeof onConfirmCallback === 'object') {
        if (cropper.target === 'form' && typeof onConfirmCallback.onFormCropped === 'function') {
          onConfirmCallback.onFormCropped(croppedBase64);
        } else if (cropper.target === 'detail' && typeof onConfirmCallback.onDetailCropped === 'function') {
          onConfirmCallback.onDetailCropped(croppedBase64);
        }
      }
    });
  }
}

export function openPhotoCropper(file, target) {
  if (!file.type.startsWith('image/')) {
    showToast('يرجى اختيار ملف صورة صالح (JPG, PNG, WebP)', 'warning');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast('حجم الصورة كبير جداً، الحد الأقصى 10 ميجابايت', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      cropper.image = img;
      cropper.target = target;
      cropper.rotation = 0;
      cropper.x = 0;
      cropper.y = 0;

      const cropDiameter = cropper.cropRadius * 2;
      const scaleX = cropDiameter / img.width;
      const scaleY = cropDiameter / img.height;
      const baseScale = Math.max(scaleX, scaleY);

      cropper.minScale = Math.max(0.05, baseScale * 0.9);
      cropper.maxScale = Math.max(3.5, baseScale * 4);
      cropper.scale = baseScale;

      const zoomRange = document.getElementById('cropper-zoom-range');
      if (zoomRange) {
        zoomRange.min = cropper.minScale.toFixed(2);
        zoomRange.max = cropper.maxScale.toFixed(2);
        zoomRange.value = baseScale.toFixed(2);
      }

      const modalCropper = document.getElementById('modal-photo-cropper');
      openModal(modalCropper);
      setTimeout(() => {
        if (cropper.draw) cropper.draw();
      }, 80);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
