let _stream = null;
let _capturedBase64 = null;
let _onCaptureChange = null;

export function initCameraManager({ onCaptureChange }) {
  _onCaptureChange = onCaptureChange;
  document.getElementById('camera-capture-btn').addEventListener('click', captureFrame);
  document.getElementById('camera-cancel-btn').addEventListener('click', closeCamera);
  document.getElementById('camera-thumb-clear').addEventListener('click', clearCapture);

  const galleryInput = document.getElementById('gallery-input');
  galleryInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      _capturedBase64 = dataUrl.split(',')[1];
      document.getElementById('camera-thumb-img').src = dataUrl;
      document.getElementById('camera-preview-thumb').classList.remove('hidden');
      _onCaptureChange?.(_capturedBase64);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
}

export function openGallery() {
  document.getElementById('gallery-input').click();
}

export function getCapturedImage() {
  return _capturedBase64;
}

export function clearCapture() {
  _capturedBase64 = null;
  document.getElementById('camera-preview-thumb').classList.add('hidden');
  _onCaptureChange?.(null);
}

export async function openCamera() {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    document.getElementById('camera-preview').srcObject = _stream;
    document.getElementById('camera-overlay').classList.remove('hidden');
  } catch (err) {
    alert('カメラにアクセスできませんでした: ' + err.message);
  }
}

function captureFrame() {
  const video = document.getElementById('camera-preview');
  const MAX = 1280;
  let w = video.videoWidth, h = video.videoHeight;
  if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  _capturedBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

  document.getElementById('camera-thumb-img').src = `data:image/jpeg;base64,${_capturedBase64}`;
  document.getElementById('camera-preview-thumb').classList.remove('hidden');

  closeCamera();
  _onCaptureChange?.(_capturedBase64);
}

function closeCamera() {
  _stream?.getTracks().forEach(t => t.stop());
  _stream = null;
  document.getElementById('camera-overlay').classList.add('hidden');
}
