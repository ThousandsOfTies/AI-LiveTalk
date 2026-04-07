/**
 * TTS 中に VRM の口を動かす簡易リップシンク
 * SpeechSynthesis は音声波形を公開しないため、
 * サイン波でアニメーションする。
 */
export class LipSync {
  constructor(vrmViewer) {
    this.viewer = vrmViewer;
    this.active = false;
    this._raf = null;
    this._phase = 0;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._phase = 0;
    this._loop();
  }

  stop() {
    this.active = false;
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this.viewer.resetLipSync();
  }

  _loop() {
    if (!this.active) return;

    this._phase += 0.14;
    // 発話らしい不規則なリズムを作る
    const base = Math.max(0, Math.sin(this._phase * 2.8));
    const mod = Math.max(0, Math.sin(this._phase * 1.1 + 1.2));
    const open = base * 0.55 + mod * 0.2;

    this.viewer.setLipSync('aa', Math.min(1, open));

    this._raf = requestAnimationFrame(() => this._loop());
  }
}
