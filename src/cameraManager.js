const MAX_IMAGE_WIDTH = 1280;
const JPEG_QUALITY    = 0.85;

let _stream         = null;
let _capturedBase64 = null;
let _thumbEl, _thumbImg, _overlayEl, _previewEl, _galleryInput;

export function initCameraManager() {
  _thumbEl      = document.getElementById('camera-preview-thumb');
  _thumbImg     = document.getElementById('camera-thumb-img');
  _overlayEl    = document.getElementById('camera-overlay');
  _previewEl    = document.getElementById('camera-preview');
  _galleryInput = document.getElementById('gallery-input');

  document.getElementById('camera-capture-btn').addEventListener('click', captureFrame);
  document.getElementById('camera-cancel-btn').addEventListener('click', closeCamera);
  document.getElementById('camera-thumb-clear').addEventListener('click', clearCapture);
  _galleryInput.addEventListener('change', _handleGallerySelection);
}

export function getCapturedImage() {
  return _capturedBase64;
}

export function clearCapture() {
  _capturedBase64 = null;
  _thumbEl.classList.add('hidden');
}

export function openGallery() {
  _galleryInput.click();
}

export async function openCamera() {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    _previewEl.srcObject = _stream;
    _overlayEl.classList.remove('hidden');
  } catch (err) {
    alert('カメラにアクセスできませんでした: ' + err.message);
  }
}

function captureFrame() {
  const v = _previewEl;
  _setCapturedImage(_drawScaledToJpeg(v, v.videoWidth, v.videoHeight));
  closeCamera();
}

function _handleGallerySelection(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => _setCapturedImage(_drawScaledToJpeg(img, img.naturalWidth, img.naturalHeight));
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function _drawScaledToJpeg(source, srcW, srcH) {
  let w = srcW, h = srcH;
  if (w > MAX_IMAGE_WIDTH) {
    h = Math.round(h * MAX_IMAGE_WIDTH / w);
    w = MAX_IMAGE_WIDTH;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
}

function _setCapturedImage(base64) {
  _capturedBase64 = base64;
  _thumbImg.src = `data:image/jpeg;base64,${base64}`;
  _thumbEl.classList.remove('hidden');
}

function closeCamera() {
  _stream?.getTracks().forEach(t => t.stop());
  _stream = null;
  _overlayEl.classList.add('hidden');
}
