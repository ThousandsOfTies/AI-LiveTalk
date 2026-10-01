import { designGeminiVoice, synthesizeGeminiSpeech } from './gemini-tts.js';
import { resolveGeminiApiKey } from './gemini-key-bridge.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'ai-livetalk-gemini-voice-lab';
const saved = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
})();
const voices = Array.isArray(saved) ? saved.filter(v => v.id?.startsWith('voice_')) : [];
const audioUrls = new Map();

function setStatus(message) { $('status').textContent = message; }
async function getApiKey() {
  const key = await resolveGeminiApiKey();
  $('key-status').textContent = key
    ? '✓ AI-LiveTalkの共通APIキーを使用します'
    : 'AI-LiveTalkの「設定 → LLM」でGemini APIキーを設定してください。';
  if (!key) throw new Error('Gemini APIキーがありません。AI-LiveTalkのLLMタブで設定してください。');
  return key;
}
function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(voices.map(({ id, name, description }) => ({ id, name, description }))));
}
function setAudio(id, buffer) {
  if (audioUrls.has(id)) URL.revokeObjectURL(audioUrls.get(id));
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  audioUrls.set(id, url);
  return url;
}
function button(label, action) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', action);
  return el;
}
function render() {
  const list = $('voices');
  list.replaceChildren();
  $('empty').hidden = voices.length > 0;
  for (const voice of voices) {
    const card = document.createElement('article');
    card.className = 'voice-card';
    const title = document.createElement('h3');
    title.textContent = voice.name;
    const description = document.createElement('p');
    description.textContent = voice.description;
    const id = document.createElement('div');
    id.className = 'voice-id';
    id.textContent = voice.id;
    const player = document.createElement('audio');
    player.controls = true;
    if (audioUrls.has(voice.id)) player.src = audioUrls.get(voice.id);
    else player.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('説明を再編集', () => {
        $('voice-name').value = voice.name;
        $('description').value = voice.description;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setStatus('説明を読み込みました。編集して新しい声を作れます。');
      }),
      button('この声で日本語を試聴', async event => {
        const target = event.currentTarget;
        target.disabled = true;
        setStatus(`${voice.name} を合成中…`);
        try {
          const audio = await synthesizeGeminiSpeech({
            apiKey: await getApiKey(), model: $('model').value, voiceId: voice.id,
            text: $('sample-text').value, style: $('style').value,
          });
          player.src = setAudio(voice.id, audio);
          player.hidden = false;
          await player.play();
          setStatus(`${voice.name} を再生しています。`);
        } catch (error) { setStatus(error.message); }
        finally { target.disabled = false; }
      }),
      button('WAVを保存', () => {
        const url = audioUrls.get(voice.id);
        if (!url) { setStatus('先に「この声で日本語を試聴」を実行してください。'); return; }
        const link = document.createElement('a');
        link.href = url;
        link.download = `${voice.name.replace(/[\\/:*?"<>|]/g, '_')}.wav`;
        link.click();
      }),
      button('Voice IDをコピー', async () => {
        try { await navigator.clipboard.writeText(voice.id); setStatus('Voice IDをコピーしました。'); }
        catch { setStatus(`コピーできませんでした。Voice ID: ${voice.id}`); }
      }),
      button('一覧から削除', () => {
        // Google側に保存された声は削除しない。誤って共有プロジェクトの声を消さないため。
        const index = voices.findIndex(item => item.id === voice.id);
        if (index >= 0) voices.splice(index, 1);
        if (audioUrls.has(voice.id)) URL.revokeObjectURL(audioUrls.get(voice.id));
        audioUrls.delete(voice.id);
        persist(); render();
      }),
    );
    card.append(title, description, id, player, actions);
    list.append(card);
  }
}

$('create').addEventListener('click', async event => {
  const target = event.currentTarget;
  target.disabled = true;
  setStatus('声を作成中…');
  try {
    const voice = await designGeminiVoice({
      apiKey: await getApiKey(),
      name: $('voice-name').value, description: $('description').value,
    });
    voices.unshift(voice);
    persist(); render();
    setStatus('新しい声を作成しました。「この声で日本語を試聴」を押すと、入力したセリフを再生します。');
  } catch (error) { setStatus(error.message); }
  finally { target.disabled = false; }
});

window.addEventListener('beforeunload', () => {
  for (const url of audioUrls.values()) URL.revokeObjectURL(url);
});
render();
getApiKey().catch(() => {});
window.addEventListener('focus', () => getApiKey().catch(() => {}));
