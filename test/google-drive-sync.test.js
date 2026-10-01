import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleDriveSync } from '../src/google-drive-sync.js';

for (const existingFile of [true, false]) {
  test(`64KiBを超える履歴をDriveへ${existingFile ? '更新' : '新規保存'}できる`, async t => {
    const messages = Array.from({ length: 210 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user', content: '日本語での長い会話です。'.repeat(30),
    }));
    const drive = new GoogleDriveSync();
    drive._token = 'test-token';
    let written;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (url.includes('/upload/')) {
        const bodySize = options.body instanceof Blob ? options.body.size
          : (await new Request(url, { method: options.method, body: options.body }).arrayBuffer()).byteLength;
        if (options.keepalive && bodySize > 65536) {
          throw new TypeError('Failed to fetch');
        }
        assert.notEqual(options.keepalive, true);
        const blob = options.body instanceof Blob ? options.body : options.body.get('file');
        assert.ok(blob.size > 65536);
        written = JSON.parse(await blob.text());
        return new Response(JSON.stringify({ id: 'history-file' }), { status: 200 });
      }
      if (url.includes('alt=media')) return new Response(JSON.stringify(written), { status: 200 });
      return new Response(JSON.stringify({ files: existingFile || written ? [{ id: 'history-file' }] : [] }), { status: 200 });
    });
    await drive.saveHistory(messages);
    const restored = await drive.loadHistory();
    assert.deepEqual(restored.messages, messages);
    assert.ok(restored.savedAt);
  });
}

test('VRMの再開可能アップロードもkeepaliveの容量制限を受けない', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'PUT');
    assert.ok(options.body.size > 65536);
    assert.notEqual(options.keepalive, true);
    return new Response('', { status: 200 });
  });
  await new GoogleDriveSync()._putToResumableUrl('https://example.com/upload', new Blob(['x'.repeat(70000)]));
});
