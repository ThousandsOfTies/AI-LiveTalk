let _viewer;
let _wakeLock = null;

export function initPlatformUtils({ viewer }) {
  _viewer = viewer;

  // Wake Lock
  _acquireWakeLock();
  document.addEventListener('pointerdown', _acquireWakeLock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _acquireWakeLock();
  });
  window.addEventListener('focus',    _acquireWakeLock);
  window.addEventListener('pageshow', _acquireWakeLock);

  // PWA: Service Worker（本番ビルドのみ登録。開発時はキャッシュが古いJSを返すため無効）
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
        .catch(err => console.warn('SW 登録失敗:', err));
    });
  }

  // Resize
  window.addEventListener('resize', () => _viewer.resize());

  // モバイル: キーボード表示時にビューアを非表示にし、visualViewport でレイアウト高さを調整する
  const chatInput   = document.getElementById('chat-input');
  const viewerPanel = document.getElementById('viewer-panel');
  const appEl       = document.getElementById('app');

  if (navigator.maxTouchPoints > 0) {
    chatInput.addEventListener('focus', () => {
      viewerPanel.style.display = 'none';
    });
    chatInput.addEventListener('blur', () => {
      const chatMessages = document.getElementById('chat-messages');
      const distanceFromBottom =
        chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
      setTimeout(() => {
        viewerPanel.style.display = '';
        appEl.style.height = '';
        _viewer.resize();
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        requestAnimationFrame(() => {
          if (distanceFromBottom < 80) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
          } else {
            chatMessages.scrollTop =
              chatMessages.scrollHeight - chatMessages.clientHeight - distanceFromBottom;
          }
        });
      }, 300);
    });

    // visualViewport API でキーボード高さを検出し、#app の高さを視覚的なビューポートに合わせる
    // iOS Safari では position:fixed でもキーボードがコンテンツを覆う場合があるため
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (document.activeElement === chatInput) {
          appEl.style.height = window.visualViewport.height + 'px';
        }
      });
    }
  }
}

async function _acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (_wakeLock && !_wakeLock.released) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    console.log('[WakeLock] スクリーンロック防止を取得しました');
    _wakeLock.addEventListener('release', () => {
      console.log('[WakeLock] 解放されました。再取得を試みます...');
      _wakeLock = null;
      if (document.visibilityState === 'visible') _acquireWakeLock();
    });
  } catch (err) {
    console.warn('[WakeLock] 取得失敗:', err.message);
  }
}
