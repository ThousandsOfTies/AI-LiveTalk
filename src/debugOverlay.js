/**
 * モバイルデバッグオーバーレイ
 * URL に ?debug を付けてアクセスすると画面上部にログパネルが表示される。
 * 例: https://thousandsofties.github.io/AI-LiveTalk/?debug
 */

const MAX_LINES = 40;
const _lines    = [];
let _content    = null;
let _panel      = null;
let _collapsed  = false;

function _render() {
  if (!_content) return;
  _content.innerHTML = _lines
    .map(l => `<div style="color:${l.color};border-bottom:1px solid #1a1a1a;padding:2px 0">${_esc(l.text)}</div>`)
    .join('');
  _content.scrollTop = _content.scrollHeight;
}

function _esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _push(color, prefix, args) {
  const body = args.map(a => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');

  const time = new Date().toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  _lines.push({ color, text: `${time} [${prefix}] ${body}` });
  if (_lines.length > MAX_LINES) _lines.shift();
  _render();
}

function _setCollapsed(v) {
  _collapsed = v;
  _content.style.display   = v ? 'none' : 'block';
  _panel.style.height      = v ? 'auto' : '35vh';
}

function _buildPanel() {
  _panel = document.createElement('div');
  Object.assign(_panel.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    right:         '0',
    height:        '35vh',
    background:    'rgba(0,0,0,0.92)',
    color:         '#0f0',
    fontFamily:    'monospace',
    fontSize:      '11px',
    zIndex:        '99999',
    display:       'flex',
    flexDirection: 'column',
    borderBottom:  '2px solid #0f0',
  });

  // ヘッダー
  const hdr = document.createElement('div');
  Object.assign(hdr.style, {
    padding:        '5px 8px',
    borderBottom:   '1px solid #0a0',
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    flexShrink:     '0',
    cursor:         'pointer',
    userSelect:     'none',
  });

  const title = document.createElement('span');
  title.textContent = '🐛 Debug (?debug)  ▲ タップで折りたたみ';

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap     = '6px';

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  Object.assign(clearBtn.style, {
    background: '#001800', border: '1px solid #0a0', color: '#0f0',
    padding: '2px 8px', cursor: 'pointer', borderRadius: '4px', fontSize: '11px',
  });
  clearBtn.onclick = (e) => { e.stopPropagation(); _lines.length = 0; _render(); };

  btnRow.append(clearBtn);
  hdr.append(title, btnRow);

  // ヘッダークリックで折りたたみ
  hdr.addEventListener('click', () => {
    _setCollapsed(!_collapsed);
    title.textContent = _collapsed
      ? '🐛 Debug (?debug)  ▼ タップで展開'
      : '🐛 Debug (?debug)  ▲ タップで折りたたみ';
  });

  _panel.appendChild(hdr);

  _content = document.createElement('div');
  Object.assign(_content.style, {
    flex:      '1',
    overflowY: 'auto',
    padding:   '4px 8px',
    whiteSpace:'pre-wrap',
    wordBreak: 'break-all',
  });
  _panel.appendChild(_content);
  document.body.appendChild(_panel);
}

export function initDebugOverlay() {
  if (!new URLSearchParams(location.search).has('debug')) return;

  // DOM が準備できてから挿入
  const setup = () => {
    _buildPanel();

    // console を傍受
    const orig = {
      log:   console.log.bind(console),
      warn:  console.warn.bind(console),
      error: console.error.bind(console),
    };
    console.log   = (...a) => { orig.log(...a);   _push('#8f8', 'LOG',  a); };
    console.warn  = (...a) => { orig.warn(...a);  _push('#ff8', 'WARN', a); };
    console.error = (...a) => { orig.error(...a); _push('#f88', 'ERR',  a); };

    window.addEventListener('unhandledrejection', e =>
      _push('#f44', 'REJECT', [e.reason?.message ?? String(e.reason)]));
    window.addEventListener('error', e =>
      _push('#f44', 'ERROR',  [e.message]));

    _push('#fff', 'DEBUG', ['パネル起動。ヘッダーをタップで折りたたみ可。']);
  };

  if (document.body) {
    setup();
  } else {
    document.addEventListener('DOMContentLoaded', setup);
  }
}
