import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

export class VRMViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;
    this.clock = new THREE.Clock();

    // まずレイアウトが確定してからサイズを取得
    this._w = canvas.clientWidth || 600;
    this._h = canvas.clientHeight || 600;

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();
    this._initLights();

    // アイドルアニメーション用
    this._blinkTimer = 0;
    this._blinkInterval = 3 + Math.random() * 3;
    this._isBlinking = false;
    this._blinkProgress = 0;

    // 話し中フラグ
    this._isTalking = false;

    // ジェスチャー
    this._gesture = null;         // { name, progress, duration }
    this._gestureTimer = 0;

    // VRMAアニメーション
    this._mixer = null;
    this._vrmaAction = null;
    this._vrmaPlaying = false;

    this._animate();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this._w, this._h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
  }

  _initScene() {
    this.scene = new THREE.Scene();
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(28, this._w / this._h, 0.1, 20);
    this.camera.position.set(0, 1.35, 2.2);
    this.camera.lookAt(0, 1.35, 0);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 1.35, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.update();
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xb0c8ff, 0.4);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);
  }

  /**
   * VRM ファイル (File オブジェクト or URL 文字列) を読み込む
   * @param {File|string} source
   * @param {function} onProgress
   */
  async loadVRM(source, onProgress) {
    // 既存モデルを削除
    this.stopVRMA();
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const url = source instanceof File ? URL.createObjectURL(source) : source;

    const gltf = await loader.loadAsync(url, (xhr) => {
      if (onProgress && xhr.total > 0) {
        onProgress(Math.round((xhr.loaded / xhr.total) * 100));
      }
    });

    const vrm = gltf.userData.vrm;
    VRMUtils.combineSkeletons(gltf.scene);

    // VRM 0.x は Z 軸が逆向きなので 180° 回転
    if (vrm.meta?.metaVersion === '0') {
      VRMUtils.rotateVRM0(vrm);
    }

    this.vrm = vrm;
    this.scene.add(vrm.scene);

    if (source instanceof File) URL.revokeObjectURL(url);

    this._fitCameraToVRM(vrm);

    return vrm;
  }

  /** モデルのバウンディングボックスに合わせてカメラと OrbitControls を自動調整 */
  _fitCameraToVRM(vrm) {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // モデル全体が収まる距離を算出
    const maxDim = Math.max(size.x, size.y, size.z);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect;
    const fitDist = (maxDim / 2) / Math.tan(fovRad / 2) / Math.min(1, aspect) * 1.15;

    // カメラをモデル正面・やや上から
    this.camera.position.set(center.x, center.y, center.z + fitDist);
    this.camera.near = fitDist * 0.01;
    this.camera.far  = fitDist * 10;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.update();
  }

  // ---- VRMA アニメーション API ----

  /**
   * VRMAファイルを読み込んで再生する
   * @param {File|string} source
   * @param {{ loop?: boolean }} options
   */
  async loadVRMA(source, { loop = true } = {}) {
    if (!this.vrm) throw new Error('先にVRMを読み込んでください');

    this.stopVRMA();

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const url = source instanceof File ? URL.createObjectURL(source) : source;
    try {
      const gltf = await loader.loadAsync(url);
      const vrmAnimations = gltf.userData.vrmAnimations;
      if (!vrmAnimations || vrmAnimations.length === 0) {
        throw new Error('VRMAファイルにアニメーションが含まれていません');
      }

      const clip = createVRMAnimationClip(vrmAnimations[0], this.vrm);
      this._mixer = new THREE.AnimationMixer(this.vrm.scene);
      this._vrmaAction = this._mixer.clipAction(clip);

      if (!loop) {
        this._vrmaAction.setLoop(THREE.LoopOnce, 1);
        this._vrmaAction.clampWhenFinished = true;
      }

      this._vrmaAction.play();
      this._vrmaPlaying = true;
    } finally {
      if (source instanceof File) URL.revokeObjectURL(url);
    }
  }

  /** VRMAアニメーションを停止してアイドルモーションに戻す */
  stopVRMA() {
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
      this._vrmaAction = null;
    }
    this._vrmaPlaying = false;
  }

  // ---- 表情 API ----

  setExpression(name, value = 1.0) {
    this.vrm?.expressionManager?.setValue(name, Math.max(0, Math.min(1, value)));
  }

  resetExpressions() {
    if (!this.vrm?.expressionManager) return;
    ['happy', 'angry', 'sad', 'surprised', 'relaxed'].forEach((n) =>
      this.vrm.expressionManager.setValue(n, 0)
    );
  }

  /**
   * 感情名からアバターの表情とジェスチャーを自動適用する
   * @param {'happy'|'sad'|'angry'|'surprised'|'relaxed'|'neutral'} emotion
   */
  applyEmotion(emotion) {
    const MAP = {
      happy:     { expr: 'happy',     intensity: 0.75, gesture: 'nod'       },
      sad:       { expr: 'sad',       intensity: 0.65, gesture: null        },
      angry:     { expr: 'angry',     intensity: 0.6,  gesture: 'shake'     },
      surprised: { expr: 'surprised', intensity: 0.8,  gesture: 'surprised' },
      relaxed:   { expr: 'relaxed',   intensity: 0.6,  gesture: null        },
      neutral:   { expr: null,        intensity: 0,    gesture: null        },
    };
    const entry = MAP[emotion] ?? MAP['neutral'];
    this.resetExpressions();
    if (entry.expr) this.setExpression(entry.expr, entry.intensity);
    if (entry.gesture) this.playGesture(entry.gesture);
  }

  /** 口の形（リップシンク）
   *  phoneme: 'aa' | 'ih' | 'ou' | 'ee' | 'oh'
   */
  setLipSync(phoneme, value) {
    this.vrm?.expressionManager?.setValue(phoneme, Math.max(0, Math.min(1, value)));
  }

  resetLipSync() {
    ['aa', 'ih', 'ou', 'ee', 'oh'].forEach((p) => this.setLipSync(p, 0));
  }

  // ---- リサイズ ----

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this._w = w;
    this._h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // ---- アニメーションループ ----

  _updateBlinking(delta) {
    this._blinkTimer += delta;

    if (!this._isBlinking && this._blinkTimer >= this._blinkInterval) {
      this._isBlinking = true;
      this._blinkProgress = 0;
      this._blinkTimer = 0;
      this._blinkInterval = 3 + Math.random() * 4;
    }

    if (this._isBlinking) {
      this._blinkProgress += delta / 0.14;
      const v = Math.max(0, Math.sin(this._blinkProgress * Math.PI));
      this.vrm.expressionManager?.setValue('blink', v);
      if (this._blinkProgress >= 1) {
        this._isBlinking = false;
        this.vrm.expressionManager?.setValue('blink', 0);
      }
    }
  }

  // ---- 話し中モード ----

  /** LLM 返答開始時に呼ぶ */
  startTalking() { this._isTalking = true; }

  /** 返答終了時に呼ぶ */
  stopTalking() { this._isTalking = false; }

  // ---- ジェスチャー API ----

  /**
   * @param {'nod'|'shake'|'wave'|'surprised'} name
   */
  playGesture(name) {
    const durations = { nod: 1.0, shake: 1.2, wave: 2.0, surprised: 0.8 };
    this._gesture = { name, progress: 0, duration: durations[name] ?? 1.0 };
  }

  // ---- アイドル・トーキングモーション ----

  _updateIdleMotion(t) {
    if (!this.vrm?.humanoid) return;
    const h = this.vrm.humanoid;

    const talking = this._isTalking;
    const breathAmp  = talking ? 0.022 : 0.012;
    const swayAmp    = talking ? 0.025 : 0.012;
    const headYAmp   = talking ? 0.06  : 0.04;
    const headXAmp   = talking ? 0.04  : 0.018;
    const shoulderAmp= talking ? 0.04  : 0.018;
    const armAmp     = talking ? 0.06  : 0.025;

    // --- 呼吸 (chest/upperChest) ---
    const breath = Math.sin(t * 1.6) * breathAmp;
    _rot(h, 'chest',      { x: breath });
    _rot(h, 'upperChest', { x: breath * 0.6 });

    // --- 体幹の揺れ ---
    _rot(h, 'spine', { z: Math.sin(t * 0.35) * swayAmp });
    _rot(h, 'hips',  { z: Math.sin(t * 0.28 + 0.5) * swayAmp * 0.5 });

    // --- 頭 ---
    const headNode = h.getNormalizedBoneNode('head');
    if (headNode && !this._gesture) {
      headNode.rotation.y = Math.sin(t * 0.25) * headYAmp;
      headNode.rotation.x = Math.sin(t * 0.18) * headXAmp;
    }

    // --- 肩 ---
    _rot(h, 'leftShoulder',  { z:  Math.sin(t * 0.4) * shoulderAmp });
    _rot(h, 'rightShoulder', { z: -Math.sin(t * 0.4 + 0.3) * shoulderAmp });

    // --- 上腕 (自然な下げ: z≒1.2 rad ≒ 70°) ---
    _rot(h, 'leftUpperArm',  { z:  1.2 + Math.sin(t * 0.5) * armAmp, x:  0.05 });
    _rot(h, 'rightUpperArm', { z: -1.2 - Math.sin(t * 0.5 + 0.4) * armAmp, x:  0.05 });

    // --- 前腕 ---
    _rot(h, 'leftLowerArm',  { z:  0.1 + Math.sin(t * 0.6) * 0.03 });
    _rot(h, 'rightLowerArm', { z: -0.1 - Math.sin(t * 0.6 + 0.2) * 0.03 });
  }

  _updateGesture(delta) {
    if (!this._gesture || !this.vrm?.humanoid) return;
    const g = this._gesture;
    g.progress += delta / g.duration;
    const p = Math.min(g.progress, 1);
    const h = this.vrm.humanoid;

    if (g.name === 'nod') {
      const v = Math.sin(p * Math.PI * 3) * 0.18;
      _rot(h, 'head', { x: v });
      _rot(h, 'neck', { x: v * 0.5 });
    } else if (g.name === 'shake') {
      const v = Math.sin(p * Math.PI * 4) * 0.2;
      _rot(h, 'head', { y: v });
      _rot(h, 'neck', { y: v * 0.4 });
    } else if (g.name === 'wave') {
      // 右腕を振る
      const angle = -0.8 + Math.sin(p * Math.PI * 4) * 0.6;
      _rot(h, 'rightUpperArm', { z: angle, x: -0.3 });
      _rot(h, 'rightLowerArm', { z: -0.5 + Math.sin(p * Math.PI * 4) * 0.3 });
    } else if (g.name === 'surprised') {
      const v = Math.max(0, Math.sin(p * Math.PI));
      _rot(h, 'head', { x: -v * 0.15 });
      this.vrm.expressionManager?.setValue('surprised', v * 0.8);
    }

    if (p >= 1) {
      this._gesture = null;
      this.vrm.expressionManager?.setValue('surprised', 0);
    }
  }

  // ---- アニメーションループ (更新) ----

  _animate() {
    requestAnimationFrame(() => this._animate());
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    if (this.vrm) {
      this._updateBlinking(delta);
      if (!this._vrmaPlaying) {
        this._updateIdleMotion(elapsed);
        this._updateGesture(delta);
      }
      if (this._mixer) this._mixer.update(delta);
      this.vrm.update(delta);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ---- ユーティリティ ----

/** ボーンが存在する場合のみ rotation を部分的に上書きするヘルパー */
function _rot(humanoid, boneName, rotation) {
  const node = humanoid.getNormalizedBoneNode(boneName);
  if (!node) return;
  if (rotation.x !== undefined) node.rotation.x = rotation.x;
  if (rotation.y !== undefined) node.rotation.y = rotation.y;
  if (rotation.z !== undefined) node.rotation.z = rotation.z;
}
