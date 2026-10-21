import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Instrument layout (world units). Gourd centred at origin, neck rising along +Y.
const GOURD_R = 1.7;
const CUT = 0.95; // polar angle where the soundboard (tabli) cuts the gourd
const TABLI_Z = GOURD_R * Math.cos(CUT);
const TABLI_R = GOURD_R * Math.sin(CUT);
const GOURD_SY = 1.08;
const NECK = { y0: 1.0, y1: 8.2, r0: 0.36, r1: 0.3, z: 0.75, sz: 0.75 };
const BRIDGE = [-0.22, -0.075, 0.075, 0.22].map((x) => new THREE.Vector3(x, -0.55, 1.17));
const NUT = [-0.135, -0.045, 0.045, 0.135].map((x) => new THREE.Vector3(x, 7.85, 1.05));
const BOUNDS = { cy: 4.2, h: 12.8, w: 4.2 };

const neckRadius = (y) => NECK.r0 + ((NECK.r1 - NECK.r0) * (y - NECK.y0)) / (NECK.y1 - NECK.y0);

function woodTexture(base, grain, { w = 512, h = 1024, lines = 260, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < lines; k++) {
    const x0 = rnd() * w;
    const amp = 2 + rnd() * 10;
    const f1 = 0.004 + rnd() * 0.01;
    const f2 = 0.02 + rnd() * 0.03;
    const p = rnd() * 6.28;
    g.strokeStyle = `rgba(${grain},${0.05 + rnd() * 0.22})`;
    g.lineWidth = 0.5 + rnd() * 2.5;
    g.beginPath();
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin(y * f1 + p) * amp + Math.sin(y * f2 + p * 2) * amp * 0.25;
      y === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function radialTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function meshBetween(a, b, geometry, material) {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(geometry, material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

const RIBBON_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RIBBON_FRAG = /* glsl */ `
  uniform float uAmp; uniform float uTime; uniform float uSeed; uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float s = vUv.y;
    float x = abs(vUv.x - 0.5) * 2.0;
    float env = sin(3.14159 * s);
    float wob = 0.75 + 0.25 * sin(uTime * 37.0 + uSeed + s * 18.0);
    float w = 0.025 + uAmp * env * 0.28 * wob;
    float blur = 1.0 - smoothstep(w * 0.5, w, x);
    float glow = exp(-x * x / (w * w) * 2.5);
    float ends = smoothstep(0.0, 0.02, s) * smoothstep(1.0, 0.98, s);
    float a = (blur * 0.35 + glow) * (0.1 + uAmp * 0.75) * ends;
    gl_FragColor = vec4(uColor, a);
  }
`;

const POINTS_VERT = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aSeed;
  uniform float uPR; uniform float uTime; uniform float uTwinkle;
  varying float vA; varying vec3 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPR * (10.0 / -mv.z);
    float tw = mix(1.0, 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 40.0), uTwinkle);
    vA = aAlpha * tw; vC = aColor;
  }
`;
const POINTS_FRAG = /* glsl */ `
  varying float vA; varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.0, 0.5, d);
    gl_FragColor = vec4(vC, a * a * vA);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform vec3 uAccent;
  uniform float uTime; uniform float uLevel;
  varying vec3 vPos;
  void main() {
    vec3 d = normalize(vPos);
    float h = d.y;
    vec3 c = mix(uMid, uTop, smoothstep(-0.05, 0.6, h));
    c = mix(uBot, c, smoothstep(-0.5, 0.0, h));
    float band = sin(d.x * 3.0 + uTime * 0.06 + sin(d.z * 2.5 + uTime * 0.04) * 1.6) * 0.5 + 0.5;
    float aur = smoothstep(-0.1, 0.3, h) * smoothstep(0.8, 0.2, h) * band;
    c += uAccent * aur * (0.035 + uLevel * 0.12);
    gl_FragColor = vec4(c, 1.0);
  }
`;

function makePointsMaterial(pixelRatio, twinkle) {
  return new THREE.ShaderMaterial({
    uniforms: { uPR: { value: pixelRatio }, uTime: { value: 0 }, uTwinkle: { value: twinkle } },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class TanpuraScene {
  constructor(canvas) {
    this.canvas = canvas;
    const isMobile = matchMedia('(pointer: coarse)').matches;
    this.pixelRatio = Math.min(window.devicePixelRatio, isMobile ? 1.75 : 2);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this.pixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.06,
      enablePan: false,
      rotateSpeed: 0.55,
      minPolarAngle: Math.PI / 2 - 0.65,
      maxPolarAngle: Math.PI / 2 + 0.35,
      minAzimuthAngle: -1.2,
      maxAzimuthAngle: 1.2,
    });
    this.controls.target.set(0, BOUNDS.cy, 0);
    this.camera.position.set(0, BOUNDS.cy + 0.6, 20);
    this.zoomFactor = 1;
    this.lastInteract = -10;
    this.controls.addEventListener('start', () => (this.interacting = true));
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.lastInteract = this.clock.elapsedTime;
    });

    this.accent = [0, 1, 2, 3].map(() => new THREE.Color('#ffc46b'));
    this.accentTarget = this.accent.map((c) => c.clone());

    this._buildLights();
    this._buildSky();
    this._buildInstrument();
    this._buildFx();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.55, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.insetsTarget = { ...this.insets };
    this.level = 0;
    this.clock = new THREE.Clock();
    this._setupTap();

    window.addEventListener('resize', () => this._resize());
    this._resize();
    renderer.setAnimationLoop(() => this._frame());
  }

  // ---------- building ----------

  _buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x9d8cff, 0x2a0f1f, 0.6));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.4);
    key.position.set(4, 9, 9);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xb48cff, 2.2);
    rim.position.set(-6, 6, -6);
    s.add(rim);
    const rim2 = new THREE.DirectionalLight(0xff8fb3, 1.2);
    rim2.position.set(7, -2, -4);
    s.add(rim2);
    this.pluckLight = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
    this.pluckLight.position.set(0, 0.3, 2.6);
    s.add(this.pluckLight);
  }

  _buildSky() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uTop: { value: new THREE.Color('#07051c') },
          uMid: { value: new THREE.Color('#2a0e4a') },
          uBot: { value: new THREE.Color('#5c1846') },
          uAccent: { value: new THREE.Color('#ffc46b') },
          uTime: { value: 0 },
          uLevel: { value: 0 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.scene.add(this.sky);

    // Stars
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const alpha = new Float32Array(N);
    const seed = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 1.6 - 0.6);
      const r = 90 + Math.random() * 30;
      pos.set([r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)], i * 3);
      c.setHSL(0.1 + Math.random() * 0.6, 0.6, 0.85);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 6 + Math.random() * 16;
      alpha[i] = 0.4 + Math.random() * 0.6;
      seed[i] = Math.random();
    }
    this.stars = this._points(pos, col, size, alpha, seed, 1);
    this.scene.add(this.stars);

    // Floating golden dust around the instrument
    const D = 450;
    const dpos = new Float32Array(D * 3);
    const dcol = new Float32Array(D * 3);
    const dsize = new Float32Array(D);
    const dalpha = new Float32Array(D);
    const dseed = new Float32Array(D);
    for (let i = 0; i < D; i++) {
      dpos.set([(Math.random() - 0.5) * 18, -4 + Math.random() * 18, -8 + Math.random() * 12], i * 3);
      c.setHSL(0.08 + Math.random() * 0.08, 0.9, 0.7);
      dcol.set([c.r, c.g, c.b], i * 3);
      dsize[i] = 1.5 + Math.random() * 3.5;
      dalpha[i] = 0.25 + Math.random() * 0.5;
      dseed[i] = Math.random();
    }
    this.dust = this._points(dpos, dcol, dsize, dalpha, dseed, 1);
    this.scene.add(this.dust);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(),
        color: 0xffc46b,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.halo.position.set(0, 1.5, -3);
    this.halo.scale.setScalar(15);
    this.scene.add(this.halo);
  }

  _points(pos, col, size, alpha, seed, twinkle) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const p = new THREE.Points(g, makePointsMaterial(this.pixelRatio, twinkle));
    p.frustumCulled = false;
    return p;
  }

  _buildInstrument() {
    const inst = new THREE.Group();
    this.instrument = inst;
    this.scene.add(inst);

    const darkWood = woodTexture('#5a2412', '30,8,2', { seed: 7 });
    const neckWood = woodTexture('#4a1d0e', '20,6,2', { seed: 11 });
    const honeyWood = woodTexture('#c88a4a', '110,55,20', { seed: 3, lines: 200 });

    const gourdMat = new THREE.MeshPhysicalMaterial({
      map: darkWood, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.3, sheenColor: new THREE.Color('#ff9a6b'),
    });
    const tabliMat = new THREE.MeshPhysicalMaterial({ map: honeyWood, roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.25 });
    const neckMat = new THREE.MeshPhysicalMaterial({ map: neckWood, roughness: 0.45, clearcoat: 0.9, clearcoatRoughness: 0.18 });
    const gold = new THREE.MeshStandardMaterial({ color: '#e8b04f', metalness: 1, roughness: 0.28 });
    const bone = new THREE.MeshStandardMaterial({ color: '#f3e7cf', roughness: 0.4 });
    this.goldMat = gold;

    // Gourd (tumba) with the front cap removed for the soundboard
    const gourd = new THREE.Group();
    gourd.scale.set(1, GOURD_SY, 1);
    inst.add(gourd);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(GOURD_R, 96, 64, 0, Math.PI * 2, CUT, Math.PI - CUT), gourdMat);
    shell.geometry.rotateX(Math.PI / 2);
    gourd.add(shell);

    const tabliGeo = new THREE.CircleGeometry(TABLI_R, 96, 0, Math.PI * 2);
    const p = tabliGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i)) / TABLI_R;
      p.setZ(i, 0.08 * (1 - r * r));
    }
    tabliGeo.computeVertexNormals();
    const tabli = new THREE.Mesh(tabliGeo, tabliMat);
    tabli.position.z = TABLI_Z;
    gourd.add(tabli);

    const edge = new THREE.Mesh(new THREE.TorusGeometry(TABLI_R, 0.04, 12, 160), gold);
    edge.position.z = TABLI_Z + 0.005;
    gourd.add(edge);

    // Gold beading around the soundboard
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 12, 8), gold, 36);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const rr = TABLI_R - 0.14;
      const r = rr / TABLI_R;
      m4.makeTranslation(Math.cos(a) * rr, Math.sin(a) * rr, TABLI_Z + 0.08 * (1 - r * r) + 0.005);
      dots.setMatrixAt(i, m4);
    }
    gourd.add(dots);

    // Rosette petals on the soundboard
    const petalGeo = new THREE.CircleGeometry(0.11, 24);
    petalGeo.scale(0.45, 1, 1);
    const petals = new THREE.InstancedMesh(petalGeo, gold, 12);
    const q = new THREE.Quaternion();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const cx = 0, cy = -0.95 / GOURD_SY, rr = 0.2;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      const r = Math.hypot(px, py) / TABLI_R;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
      m4.compose(new THREE.Vector3(px, py, TABLI_Z + 0.08 * (1 - r * r) + 0.004), q, new THREE.Vector3(1, 1 / GOURD_SY, 1));
      petals.setMatrixAt(i, m4);
    }
    gourd.add(petals);

    // Neck (dandi) and head
    const neckLen = NECK.y1 - NECK.y0;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(NECK.r1, NECK.r0, neckLen, 48), neckMat);
    neck.scale.z = NECK.sz;
    neck.position.set(0, NECK.y0 + neckLen / 2, NECK.z);
    inst.add(neck);

    for (const y of [1.55, 1.75, 2.35, 7.35, 7.6]) {
      const r = neckRadius(y) + 0.014;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 48), gold);
      band.scale.z = NECK.sz;
      band.position.set(0, y, NECK.z);
      inst.add(band);
    }

    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, NECK.r1, 1.25, 48), neckMat);
    head.scale.z = NECK.sz;
    head.position.set(0, NECK.y1 + 0.625, NECK.z);
    inst.add(head);
    const headBand = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.03, 10, 48), gold);
    headBand.rotation.x = Math.PI / 2;
    headBand.scale.y = NECK.sz;
    headBand.position.set(0, NECK.y1 + 1.25, NECK.z);
    inst.add(headBand);

    const finial = new THREE.Mesh(
      new THREE.LatheGeometry(
        [[0, 0], [0.22, 0.02], [0.2, 0.12], [0.12, 0.2], [0.16, 0.32], [0.1, 0.45], [0.05, 0.6], [0, 0.75]].map(([x, y]) => new THREE.Vector2(x, y)),
        32,
      ),
      gold,
    );
    finial.position.set(0, NECK.y1 + 1.25, NECK.z);
    inst.add(finial);

    // Tuning pegs (khunti)
    for (const y of [8.5, 9.1]) {
      for (const side of [-1, 1]) {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.55, 16), neckMat);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(side * 0.5, y, NECK.z);
        inst.add(shaft);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), neckMat);
        knob.scale.set(0.55, 1.15, 1);
        knob.position.set(side * 0.85, y, NECK.z);
        inst.add(knob);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 24), gold);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(side * 0.74, y, NECK.z);
        inst.add(ring);
      }
    }

    // Bridge (ghoraj), nut and tailpiece
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.1), bone);
    bridge.position.set(0, -0.55, 1.11);
    inst.add(bridge);
    const nut = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.08), bone);
    nut.position.set(0, 7.85, 1.0);
    inst.add(nut);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12), gold);
    tail.scale.set(1.6, 0.8, 0.6);
    tail.position.set(0, -1.45, 1.02);
    inst.add(tail);

    // Strings: metal core + glowing vibration ribbon + invisible tap target
    const steel = new THREE.MeshStandardMaterial({ color: '#e6e9f2', metalness: 1, roughness: 0.22, emissive: '#000000' });
    const brass = new THREE.MeshStandardMaterial({ color: '#f0bf6a', metalness: 1, roughness: 0.25, emissive: '#000000' });
    const radii = [0.011, 0.009, 0.009, 0.015];
    this.strings = [];
    this.hitTargets = [];
    for (let i = 0; i < 4; i++) {
      const a = BRIDGE[i], b = NUT[i];
      const len = a.distanceTo(b);
      const mat = (i === 3 ? brass : steel).clone();
      const core = meshBetween(a, b, new THREE.CylinderGeometry(radii[i], radii[i], len, 8, 1, true), mat);
      inst.add(core);

      const tailEnd = new THREE.Vector3(a.x * 0.25, -1.42, 1.06);
      inst.add(meshBetween(a, tailEnd, new THREE.CylinderGeometry(radii[i], radii[i], a.distanceTo(tailEnd), 6, 1, true), mat));
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 10), bone);
      bead.position.copy(a).lerp(tailEnd, 0.45);
      inst.add(bead);

      const ribbonMat = new THREE.ShaderMaterial({
        uniforms: { uAmp: { value: 0 }, uTime: { value: 0 }, uSeed: { value: i * 1.7 }, uColor: { value: this.accent[i] } },
        vertexShader: RIBBON_VERT,
        fragmentShader: RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const ribbon = meshBetween(a, b, new THREE.PlaneGeometry(0.6, len), ribbonMat);
      ribbon.position.z += 0.004;
      ribbon.renderOrder = 2;
      inst.add(ribbon);

      const hit = meshBetween(a, b, new THREE.BoxGeometry(0.11, len, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.index = i;
      inst.add(hit);
      this.hitTargets.push(hit);

      this.strings.push({ amp: 0, core, mat, ribbon, ribbonMat });
    }
  }

  _buildFx() {
    // Expanding light rings from the soundboard
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.96, 1, 128);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.position.set(0, -0.35, 1.13);
      m.visible = false;
      this.instrument.add(m);
      this.rings.push({ mesh: m, life: 0, color: new THREE.Color() });
    }
    this.ringCursor = 0;

    // Sparkle particles released on each pluck
    const N = 420;
    this.sparkN = N;
    const pos = new Float32Array(N * 3).fill(0);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const alpha = new Float32Array(N);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = Math.random();
    this.sparks = this._points(pos, col, size, alpha, seed, 0.6);
    this.scene.add(this.sparks);
    this.sparkState = Array.from({ length: N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0 }));
    this.sparkCursor = 0;
  }

  _setupTap() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 350;
      down = null;
      if (moved > 8 || !quick) return;
      const rect = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.hitTargets, false)[0];
      if (hit) this.onStringTap?.(hit.object.userData.index);
    });
  }

  // ---------- public API ----------

  setAccents(colors) {
    colors.forEach((c, i) => this.accentTarget[i].set(c));
  }

  setInsets(insets) {
    Object.assign(this.insetsTarget, insets);
  }

  setLevel(v) {
    this.level += (v - this.level) * 0.15;
  }

  pluck(i) {
    const s = this.strings[i];
    s.amp = 1;
    this.pluckLight.color.copy(this.accent[i]);
    this.pluckLight.intensity = 6 + (i === 3 ? 3 : 0);

    const r = this.rings[this.ringCursor++ % this.rings.length];
    r.life = 1;
    r.color.copy(this.accent[i]);
    r.mesh.visible = true;

    // Emit sparkles from along the plucked string
    const a = BRIDGE[i], b = NUT[i];
    const p = new THREE.Vector3();
    const posAttr = this.sparks.geometry.attributes.position;
    const colAttr = this.sparks.geometry.attributes.aColor;
    const count = i === 3 ? 34 : 24;
    for (let k = 0; k < count; k++) {
      const idx = this.sparkCursor++ % this.sparkN;
      const st = this.sparkState[idx];
      p.copy(a).lerp(b, Math.random() * 0.6);
      this.instrument.localToWorld(p);
      posAttr.setXYZ(idx, p.x, p.y, p.z);
      const c = this.accent[i];
      colAttr.setXYZ(idx, c.r * 1.4, c.g * 1.4, c.b * 1.4);
      st.life = st.max = 2.2 + Math.random() * 2.2;
      st.vx = (Math.random() - 0.5) * 1.6;
      st.vy = 0.4 + Math.random() * 1.2;
      st.vz = 0.3 + Math.random() * 1.2;
      st.size = 3 + Math.random() * 7;
    }
  }

  // ---------- internals ----------

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this._frameCamera(true);
  }

  _frameCamera(force) {
    const t = this.insetsTarget, c = this.insets;
    let changed = force;
    for (const k of ['top', 'right', 'bottom', 'left']) {
      const d = t[k] - c[k];
      if (Math.abs(d) > 0.3) { c[k] += d * 0.12; changed = true; } else c[k] = t[k];
    }
    if (!changed) return;
    const W = window.innerWidth, H = window.innerHeight;
    const aw = Math.max(120, W - c.left - c.right);
    const ah = Math.max(120, H - c.top - c.bottom);
    this.camera.setViewOffset(W, H, (c.right - c.left) / 2, (c.bottom - c.top) / 2, W, H);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const base = Math.max((BOUNDS.h * H) / (ah * 2 * tan), (BOUNDS.w * H) / (aw * 2 * tan)) * 1.04;
    const ctrl = this.controls;
    const cur = this.camera.position.distanceTo(ctrl.target);
    if (this.baseDist) this.zoomFactor = THREE.MathUtils.clamp(cur / this.baseDist, 0.45, 1.4);
    this.baseDist = base;
    ctrl.minDistance = base * 0.45;
    ctrl.maxDistance = base * 1.4;
    const dir = this.camera.position.clone().sub(ctrl.target).normalize();
    this.camera.position.copy(ctrl.target).addScaledVector(dir, base * this.zoomFactor);
    this.camera.updateProjectionMatrix();
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    this._frameCamera(false);
    for (let i = 0; i < 4; i++) this.accent[i].lerp(this.accentTarget[i], 0.06);

    // Gentle idle sway of the instrument when the user isn't orbiting
    const idle = !this.interacting && t - this.lastInteract > 2;
    const targetRot = idle ? Math.sin(t * 0.18) * 0.32 : this.instrument.rotation.y;
    this.instrument.rotation.y += (targetRot - this.instrument.rotation.y) * 0.03;
    this.instrument.position.y = Math.sin(t * 0.6) * 0.06;
    this.instrument.rotation.z = -0.05 + Math.sin(t * 0.35) * 0.015;

    for (const s of this.strings) {
      s.amp *= Math.exp(-dt * 0.75);
      s.ribbonMat.uniforms.uAmp.value = s.amp;
      s.ribbonMat.uniforms.uTime.value = t;
      s.mat.emissive.copy(s.ribbonMat.uniforms.uColor.value).multiplyScalar(s.amp * 0.6);
    }

    this.pluckLight.intensity *= Math.exp(-dt * 2.2);

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt / 2.6;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life;
      const sc = 0.4 + Math.pow(k, 0.7) * 4.2;
      r.mesh.scale.set(sc, sc * GOURD_SY, 1);
      r.mesh.material.opacity = Math.pow(r.life, 1.6) * 0.75;
      r.mesh.material.color.copy(r.color).multiplyScalar(1.5);
    }

    const sp = this.sparks.geometry.attributes;
    for (let i = 0; i < this.sparkN; i++) {
      const st = this.sparkState[i];
      if (st.life <= 0) { if (sp.aAlpha.array[i] !== 0) sp.aAlpha.array[i] = 0; continue; }
      st.life -= dt;
      const k = Math.max(0, st.life / st.max);
      st.vx += Math.sin(t * 1.3 + i) * dt * 0.4;
      st.vy *= 1 - dt * 0.3;
      sp.position.array[i * 3] += st.vx * dt;
      sp.position.array[i * 3 + 1] += st.vy * dt;
      sp.position.array[i * 3 + 2] += st.vz * dt;
      sp.aAlpha.array[i] = Math.sin(k * Math.PI) * 0.95;
      sp.aSize.array[i] = st.size * (0.6 + k * 0.6);
    }
    sp.position.needsUpdate = sp.aAlpha.needsUpdate = sp.aSize.needsUpdate = true;
    sp.aColor.needsUpdate = true;

    const dpos = this.dust.geometry.attributes.position;
    for (let i = 0; i < dpos.count; i++) {
      let y = dpos.array[i * 3 + 1] + dt * (0.08 + this.level * 1.2);
      if (y > 14) y = -4;
      dpos.array[i * 3 + 1] = y;
    }
    dpos.needsUpdate = true;

    for (const p of [this.stars, this.dust, this.sparks]) p.material.uniforms.uTime.value = t;
    const sky = this.sky.material.uniforms;
    sky.uTime.value = t;
    sky.uLevel.value = this.level * 4;
    sky.uAccent.value.copy(this.accent[1]);
    this.halo.material.color.copy(this.accent[1]);
    this.halo.material.opacity = 0.12 + Math.min(0.18, this.level * 1.2);
    this.bloom.strength = 0.5 + Math.min(0.3, this.level * 1.5);

    this.controls.update();
    this.composer.render();
  }
}
