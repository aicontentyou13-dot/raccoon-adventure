import * as THREE from 'three';

// ===========================================================================
// Config and small helpers
// ===========================================================================
const RW = 480, RH = 270;   // internal render size, upscaled with nearest-neighbour
const PPU = 16;             // screen pixels per world unit
const D2R = Math.PI / 180;
const CAM_YAW = 22 * D2R, CAM_PITCH = 35 * D2R, CAM_DIST = 70;

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const overlay = $('overlay');
const startBtn = $('startBtn');
const heartsEl = $('hearts'), ammoCountEl = $('ammoCount'), gemCountEl = $('gemCount');
const scoreEl = $('score'), comboEl = $('combo'), timerEl = $('timer'), levelIndicatorEl = $('levelIndicator');
const buffsEl = $('buffs'), dashFillEl = $('dashFill'), chakraFillEl = $('chakraFill');
const bossBarEl = $('bossBar'), bossNameEl = $('bossName'), bossFillEl = $('bossFill');
const toastEl = $('toast'), popupsEl = $('popups'), flashEl = $('flash');
const npcPlateEl = $('npcPlate'), npcNameEl = $('npcName'), npcTextEl = $('npcText');
const heroPopEl = $('heroPop'), heroTextEl = $('heroText');

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function approach(v, target, maxDelta) {
  return v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);
}
function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

// ===========================================================================
// Audio: synthesised effects and a small adaptive chiptune sequencer
// ===========================================================================
let audioCtx = null, master = null, musicBus = null, noiseBuf = null, muted = false;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(audioCtx.destination);
    musicBus = audioCtx.createGain();
    musicBus.gain.value = 0.6;
    musicBus.connect(master);
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 1;
  toast(muted ? 'Звук вимкнено' : 'Звук увімкнено', 1.2);
}
function tone(freq, dur, type, gain, at, dest, slideTo) {
  if (!audioCtx) return;
  const t0 = at ?? audioCtx.currentTime;
  const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(dest || master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
function noise(dur, gain, at, dest, filterType, filterFreq) {
  if (!audioCtx) return;
  const t0 = at ?? audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter();
  f.type = filterType || 'highpass';
  f.frequency.value = filterFreq || 4000;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(dest || master);
  src.start(t0, Math.random() * 0.4);
  src.stop(t0 + dur + 0.02);
}
const beep = (freq, dur, type, gain, delay = 0) => { if (audioCtx) tone(freq, dur, type || 'square', gain || 0.08, audioCtx.currentTime + delay); };
const sweep = (f0, f1, dur, type, gain, delay = 0) => { if (audioCtx) tone(f0, dur, type, gain, audioCtx.currentTime + delay, master, f1); };
const hiss = (dur, gain, ftype, freq, delay = 0) => { if (audioCtx) noise(dur, gain, audioCtx.currentTime + delay, master, ftype, freq); };

function sfxJump() { beep(420, 0.15, 'square', 0.06); }
function sfxDoubleJump() { beep(600, 0.09, 'square', 0.05); beep(780, 0.09, 'square', 0.05, 0.055); }
function sfxLand() { hiss(0.07, 0.05, 'lowpass', 500); }
function sfxDash() { hiss(0.16, 0.09, 'bandpass', 2400); sweep(700, 240, 0.14, 'triangle', 0.04); }
function sfxCollect() { beep(880, 0.12, 'triangle', 0.08); beep(1200, 0.1, 'triangle', 0.06, 0.06); }
function sfxGem() { beep(1320, 0.07, 'triangle', 0.06); beep(1760, 0.1, 'triangle', 0.05, 0.05); }
function sfxPower() { [660, 880, 1100, 1320].forEach((f, i) => beep(f, 0.1, 'square', 0.05, i * 0.05)); }
function sfxShoot() { beep(1000, 0.08, 'square', 0.05); }
function sfxChargeReady() { beep(1500, 0.08, 'triangle', 0.05); beep(2000, 0.08, 'triangle', 0.04, 0.06); }
function sfxChargedShot() { sweep(300, 1400, 0.3, 'sawtooth', 0.09); hiss(0.2, 0.06, 'bandpass', 1800); }
function sfxDeny() { beep(140, 0.08, 'square', 0.04); }
function sfxHitEnemy() { beep(220, 0.07, 'square', 0.06); }
function sfxKill() { beep(180, 0.14, 'sawtooth', 0.07); beep(90, 0.12, 'sawtooth', 0.05, 0.05); }
function sfxHurt() { beep(140, 0.22, 'sawtooth', 0.09); }
function sfxPoof() { hiss(0.22, 0.1, 'lowpass', 900); sweep(520, 180, 0.16, 'triangle', 0.05); }
function sfxShieldBreak() { hiss(0.2, 0.08, 'highpass', 3000); beep(900, 0.15, 'triangle', 0.05); }
function sfxBounce() { sweep(260, 780, 0.22, 'sine', 0.1); }
function sfxCrumble() { hiss(0.6, 0.07, 'lowpass', 300); }
function sfxSpit() { sweep(520, 180, 0.18, 'square', 0.04); }
function sfxWindup() { sweep(160, 420, 0.35, 'sawtooth', 0.05); }
function sfxRoar() { sweep(110, 50, 0.9, 'sawtooth', 0.12); hiss(0.8, 0.08, 'lowpass', 400); }
function sfxSlam() { hiss(0.4, 0.14, 'lowpass', 220); sweep(80, 36, 0.35, 'sine', 0.14); }
function sfxThunder() { hiss(1.4, 0.12, 'lowpass', 180, 0.25); }
function sfxHeroPop() { [700, 940, 1180].forEach((f, i) => beep(f, 0.09, 'square', 0.05, i * 0.07)); }
function sfxShutter() { hiss(0.05, 0.1, 'highpass', 6000); beep(1400, 0.03, 'square', 0.05, 0.05); }
function sfxHoot() { sweep(520, 400, 0.16, 'sine', 0.08); sweep(470, 360, 0.22, 'sine', 0.08, 0.2); }
function sfxSecret() { [784, 988, 1175, 1568].forEach((f, i) => beep(f, 0.14, 'triangle', 0.06, i * 0.08)); }
function sfxBuy() { beep(880, 0.08, 'square', 0.05); beep(1320, 0.12, 'square', 0.05, 0.07); }
function sfxLevelUp() { [520, 660, 880].forEach((f, i) => beep(f, 0.15, 'triangle', 0.07, i * 0.1)); }
function sfxWin() { [660, 880, 1100, 1320].forEach((f, i) => beep(f, 0.2, 'triangle', 0.07, i * 0.12)); }
function sfxGameOver() { [400, 300, 200].forEach((f, i) => beep(f, 0.3, 'sawtooth', 0.07, i * 0.18)); }
function sfxFall() { beep(160, 0.25, 'sawtooth', 0.05); }

// one musical mood per biome: tempo, key, a four-bar chord loop and its scale
const MUSIC = [
  { bpm: 96, root: 60, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], scale: [0, 2, 4, 5, 7, 9, 11] },
  { bpm: 108, root: 55, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], scale: [0, 2, 4, 5, 7, 9, 11] },
  { bpm: 100, root: 57, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], scale: [0, 2, 3, 5, 7, 8, 10] },
  { bpm: 88, root: 62, chords: [[0, 3, 7], [5, 8, 12], [8, 12, 15], [7, 11, 14]], scale: [0, 2, 3, 5, 7, 8, 10] },
  { bpm: 120, root: 52, chords: [[0, 3, 7], [10, 14, 17], [8, 12, 15], [7, 11, 14]], scale: [0, 1, 3, 5, 7, 8, 10] }
];
function buildMelody(th, seed) {
  const rnd = mulberry32(seed);
  const mel = new Array(64).fill(null);
  let prev = 7;
  for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 16; s++) {
    const strong = s % 4 === 0;
    if (rnd() > (strong ? 0.85 : s % 2 === 0 ? 0.4 : 0.07)) continue;
    const pcs = strong ? th.chords[bar].map(c => c % 12) : th.scale;
    const cands = [];
    for (const pc of pcs) for (const oct of [0, 12]) {
      const n = pc + oct;
      if (n >= 3 && n <= 19 && n !== prev) cands.push(n);
    }
    cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
    prev = cands[Math.floor(rnd() * Math.min(3, cands.length))];
    mel[bar * 16 + s] = prev;
  }
  return mel;
}
MUSIC.forEach((th, i) => { th.melody = buildMelody(th, 700 + i * 31); });
const music = { step: 0, next: 0, intensity: 0.1, theme: MUSIC[0] };
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function scheduleStep(i, at, sd) {
  const th = music.theme, I = music.intensity;
  const bar = Math.floor(i / 16) % 4, s = i % 16, ch = th.chords[bar], root = th.root;
  const busy = I > 0.55;
  const bass = busy ? [0, null, 0, null, 12, null, 0, null, 0, null, 7, null, 12, null, 7, null][s] : (s === 0 ? 0 : s === 8 ? 7 : null);
  if (bass != null) tone(midi(root - 24 + ch[0] + bass), sd * (busy ? 1.7 : 6), 'triangle', 0.12, at, musicBus);
  const every = I > 0.7 ? 1 : I > 0.35 ? 2 : 4;
  if (s % every === 0) {
    const k = (s / every) % 4;
    tone(midi(root + ch[[0, 1, 2, 1][k]] + (k === 2 ? 12 : 0)), sd * every * 0.9, 'square', 0.016 + 0.012 * I, at, musicBus);
  }
  const n = th.melody[i % 64];
  if (n != null) tone(midi(root + 12 + n), sd * 2.4, busy ? 'sawtooth' : 'triangle', busy ? 0.03 : 0.05, at, musicBus);
  if (I > 0.3 && (s === 0 || s === 8 || (I > 0.8 && s === 10))) tone(130, 0.16, 'sine', 0.22, at, musicBus, 42);
  if (I > 0.5 && (s === 4 || s === 12)) noise(0.12, 0.07, at, musicBus, 'bandpass', 1900);
  if ((I > 0.2 && s % 2 === 0 && s % 4 !== 0) || I > 0.75) noise(0.03, 0.022, at, musicBus, 'highpass', 7000);
}

// how tense the music should be: calm when alone, driving near enemies, full during a boss
function musicTarget() {
  if (mode !== 'playing') return mode === 'shop' ? 0.25 : 0.12;
  if (level.boss && level.boss.alive && level.boss.awake) return 1;
  let near = Infinity;
  for (const e of level.enemies) {
    if (e.alive) near = Math.min(near, Math.hypot(e.x - player.x, e.z - player.z));
  }
  return near < 7 ? 0.8 : near < 14 ? 0.5 : 0.2;
}
function updateMusic(dt) {
  if (!audioCtx || audioCtx.state !== 'running' || !level) return;
  music.intensity += (musicTarget() - music.intensity) * Math.min(1, dt * 1.5);
  const sd = 60 / (music.theme.bpm + 30 * music.intensity) / 4;
  const now = audioCtx.currentTime;
  if (music.next < now) music.next = now + 0.05;
  while (music.next < now + 0.12) {
    scheduleStep(music.step, music.next, sd);
    music.next += sd;
    music.step++;
  }
}

// ===========================================================================
// Input
// ===========================================================================
const keys = {};
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyF', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  ensureAudio();
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  if (e.code === 'KeyP' && !e.repeat) takePhoto();
  if (GAME_KEYS.has(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function isDown(...codes) { return codes.some(c => keys[c]); }

// ===========================================================================
// Renderer / scene / camera / lights
// ===========================================================================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(RW, RH, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

function fitCanvas() {
  let s = Math.min(window.innerWidth / RW, window.innerHeight / RH);
  if (s >= 2) s = Math.floor(s);
  canvas.style.width = Math.round(RW * s) + 'px';
  canvas.style.height = Math.round(RH * s) + 'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

const skyCanvas = makeCanvas(RW, RH);
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.magFilter = skyTex.minFilter = THREE.NearestFilter;
skyTex.generateMipmaps = false;
skyTex.colorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = skyTex;
scene.fog = new THREE.Fog(0x9fd0e6, CAM_DIST + 4, CAM_DIST + 55);

const VIEW_W = RW / PPU, VIEW_H = RH / PPU;
const camera = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 0.1, 260);
const toCam = new THREE.Vector3(
  Math.sin(CAM_YAW) * Math.cos(CAM_PITCH),
  Math.sin(CAM_PITCH),
  Math.cos(CAM_YAW) * Math.cos(CAM_PITCH)
);
const camOffset = toCam.clone().multiplyScalar(CAM_DIST);
camera.position.copy(camOffset);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
const camFwdGround = new THREE.Vector3(-toCam.x, 0, -toCam.z).normalize();
const camTarget = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

// keeps texels locked to screen pixels (camera orientation is fixed)
function snapToPixel(v) {
  const r = v.dot(camRight), u = v.dot(camUp);
  v.addScaledVector(camRight, Math.round(r * PPU) / PPU - r);
  v.addScaledVector(camUp, Math.round(u * PPU) / PPU - u);
  return v;
}
function screenPos(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  const r = canvas.getBoundingClientRect();
  return [r.left + (tmpV.x * 0.5 + 0.5) * r.width, r.top + (-tmpV.y * 0.5 + 0.5) * r.height];
}

const hemi = new THREE.HemisphereLight(0xd8efff, 0x8a7a66, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0cc, 2.5);
const sunDir = new THREE.Vector3(-14, 26, 12).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0012;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

function paintSky(stops, stars) {
  const g = skyCanvas.getContext('2d');
  const img = g.createImageData(RW, RH);
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const BANDS = 16;
  const colorAt = (t) => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const k = (t - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(j => a[1][j] + (b[1][j] - a[1][j]) * k);
      }
    }
    return stops[stops.length - 1][1];
  };
  for (let y = 0; y < RH; y++) {
    const f = (y / (RH - 1)) * BANDS;
    const band = Math.floor(f), frac = f - band;
    for (let x = 0; x < RW; x++) {
      const b = frac > (bayer[y & 3][x & 3] + 0.5) / 16 ? band + 1 : band;
      const col = colorAt(Math.min(1, b / BANDS));
      const o = (y * RW + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  if (stars) {
    const rnd = mulberry32(99);
    for (let i = 0; i < 150; i++) {
      const o = (((rnd() * RH * 0.85) | 0) * RW + ((rnd() * RW) | 0)) * 4;
      const v = 170 + rnd() * 85;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = Math.min(255, v + 30);
    }
  }
  g.putImageData(img, 0, 0);
  skyTex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Biomes: each level has its own time of day, light and weather
// ---------------------------------------------------------------------------
const THEMES = [
  { // morning
    sky: [[0, [118, 170, 226]], [0.45, [196, 214, 236]], [0.75, [255, 222, 196]], [1, [226, 190, 190]]],
    fog: 0xe6d6d0, hemiSky: 0xfff0e0, hemiGround: 0x8a7a70, hemiI: 1.45,
    sun: 0xffd9b0, sunI: 2.3, sunDir: [12, 22, 14], cloud: 0xffffff, cloudE: 0x7a6468, tint: 0xffffff
  },
  { // noon
    sky: [[0, [52, 124, 196]], [0.4, [96, 172, 220]], [0.72, [150, 208, 228]], [1, [104, 170, 204]]],
    fog: 0x9fd0e6, hemiSky: 0xd8efff, hemiGround: 0x8a7a66, hemiI: 1.5,
    sun: 0xfff0cc, sunI: 2.5, sunDir: [-14, 26, 12], cloud: 0xffffff, cloudE: 0x52687a, tint: 0xffffff
  },
  { // sunset
    sky: [[0, [74, 62, 128]], [0.4, [196, 96, 120]], [0.7, [255, 160, 96]], [1, [255, 206, 130]]],
    fog: 0xe09a80, hemiSky: 0xffc9a0, hemiGround: 0x5a4458, hemiI: 1.15,
    sun: 0xff9a58, sunI: 2.7, sunDir: [-22, 11, 9], cloud: 0xffd0b8, cloudE: 0x7a3a40, tint: 0xffe2cc
  },
  { // night
    sky: [[0, [10, 14, 40]], [0.5, [22, 32, 74]], [1, [40, 58, 110]]], stars: true,
    fog: 0x18244a, hemiSky: 0x7088d0, hemiGround: 0x202840, hemiI: 1.25,
    sun: 0xa8c0ff, sunI: 1.2, sunDir: [14, 22, 10], cloud: 0x8494c0, cloudE: 0x141c38, tint: 0xb8c4f0,
    fireflies: true, lanterns: true
  },
  { // storm
    sky: [[0, [36, 38, 56]], [0.5, [66, 70, 92]], [1, [96, 100, 118]]],
    fog: 0x4a5068, hemiSky: 0xa8b0c8, hemiGround: 0x3a3a48, hemiI: 1.25,
    sun: 0xc8d0e8, sunI: 1.3, sunDir: [-10, 26, 10], cloud: 0x7a8094, cloudE: 0x1c2030, tint: 0xc8cce0,
    rain: true, lightning: true
  }
];
let theme = THEMES[0];
const spriteTint = new THREE.Color(0xffffff);

// ===========================================================================
// Procedural pixel textures and materials
// ===========================================================================
function pixTex(w, h, seed, repeatU, repeatV, draw) {
  const c = makeCanvas(w, h);
  draw(c.getContext('2d'), w, h, mulberry32(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatU, repeatV);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, w, h, rnd, base, colors, density) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rnd() < density) {
      g.fillStyle = colors[(rnd() * colors.length) | 0];
      g.fillRect(x, y, 1, 1);
    }
  }
}
function cracks(g, w, h, rnd, color, count) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    let x = (rnd() * w) | 0, y = (rnd() * h) | 0;
    for (let k = 0; k < 9; k++) {
      g.fillRect(((x % w) + w) % w, ((y % h) + h) % h, 1, 1);
      if (rnd() < 0.5) x += rnd() < 0.5 ? 1 : -1; else y += 1;
    }
  }
}

const texGrassTop = pixTex(32, 32, 11, 0.5, 0.5, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#4f9a3a', ['#5fae45', '#5fae45', '#438a31', '#6dbb4c'], 0.34);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = ['#f2e36b', '#f5f5f0', '#e0568c'][(rnd() * 3) | 0];
    g.fillRect((rnd() * w) | 0, (rnd() * h) | 0, 1, 1);
  }
});
const texGrassSide = pixTex(32, 16, 12, 0.5, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#7a5a3c', ['#6a4c32', '#8a6a48', '#5e432c'], 0.3);
  for (let x = 0; x < w; x++) {
    const d = 3 + ((rnd() * 3) | 0);
    g.fillStyle = '#4f9a3a'; g.fillRect(x, 0, 1, d);
    g.fillStyle = '#6dbb4c'; g.fillRect(x, 0, 1, 1);
    g.fillStyle = '#3b7d2c'; g.fillRect(x, d, 1, 1);
  }
});
const texDirt = pixTex(16, 16, 13, 1, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#6a4c32', ['#5e432c', '#7a5a3c'], 0.3);
});
const texRock = pixTex(32, 32, 14, 0.5, 0.5, (g, w, h, rnd) => {
  g.fillStyle = '#4f433d';
  g.fillRect(0, 0, w, h);
  const shades = ['#75655b', '#6b5c53', '#7f6f64', '#665750'];
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    let x = -((rnd() * 8) | 0);
    while (x < w) {
      const bw = 8 + ((rnd() * 8) | 0);
      g.fillStyle = shades[(rnd() * shades.length) | 0];
      g.fillRect(x + 1, y + 1, bw - 1, 7);
      g.fillStyle = '#8b7a6e';
      g.fillRect(x + 1, y + 1, bw - 1, 1);
      x += bw;
    }
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rnd() < 0.5 ? '#5a4c45' : '#857468';
    g.fillRect((rnd() * w) | 0, (rnd() * h) | 0, 1, 1);
  }
});
// crumbling platforms: pale cracked stone, so they read as unsafe at a glance
const texCrackTop = pixTex(32, 32, 21, 0.5, 0.5, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#a9a091', ['#b8afa0', '#9a9183', '#c4bbac'], 0.35);
  cracks(g, w, h, rnd, '#5a5148', 9);
});
const texCrackSide = pixTex(32, 16, 22, 0.5, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#8f8678', ['#9d9486', '#7f7669'], 0.3);
  g.fillStyle = '#c4bbac'; g.fillRect(0, 0, w, 2);
  cracks(g, w, h, rnd, '#5a5148', 5);
});
const texLeaves = pixTex(16, 16, 15, 1, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#2f7d4a', ['#3f9a5c', '#25633b', '#25633b', '#4aa866'], 0.45);
});
const texLeavesLight = pixTex(16, 16, 16, 1, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#3a8f55', ['#4eae69', '#2f7d4a', '#2f7d4a', '#5cbc76'], 0.45);
});
const texBark = pixTex(16, 16, 17, 1, 1, (g, w, h, rnd) => {
  g.fillStyle = '#6b4a30'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    if (rnd() < 0.4) { g.fillStyle = rnd() < 0.5 ? '#553a25' : '#7d583a'; g.fillRect(x, 0, 1, h); }
  }
});
const texPlank = pixTex(16, 16, 18, 1, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#9a6a42', ['#8a5d39', '#a87748'], 0.25);
  g.fillStyle = '#6e4a2d';
  for (let y = 3; y < h; y += 4) g.fillRect(0, y, w, 1);
});
const texRoof = pixTex(16, 16, 19, 1, 1, (g, w, h, rnd) => {
  speckle(g, w, h, rnd, '#6a3f4f', ['#5a3444', '#7a4b5c'], 0.3);
  g.fillStyle = '#48283a';
  for (let y = 3; y < h; y += 4) g.fillRect(0, y, w, 1);
  for (let y = 0; y < h; y += 4) for (let x = (y % 8 ? 0 : 4); x < w; x += 8) g.fillRect(x, y, 1, 4);
});

const lambert = (map) => new THREE.MeshLambertMaterial({ map });
const M = {
  grassTop: lambert(texGrassTop),
  grassSide: lambert(texGrassSide),
  dirt: lambert(texDirt),
  rock: lambert(texRock),
  crackTop: lambert(texCrackTop),
  crackSide: lambert(texCrackSide),
  leaves: lambert(texLeaves),
  leavesLight: lambert(texLeavesLight),
  bark: lambert(texBark),
  plank: lambert(texPlank),
  roof: lambert(texRoof)
};
const slabMats = [M.grassSide, M.grassSide, M.grassTop, M.dirt, M.grassSide, M.grassSide];
const crackMats = [M.crackSide, M.crackSide, M.crackTop, M.dirt, M.crackSide, M.crackSide];

const flatCache = new Map();
function flat(color) {
  if (!flatCache.has(color)) flatCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return flatCache.get(color);
}
const glowCache = new Map();
function glow(color) {
  if (!glowCache.has(color)) glowCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return glowCache.get(color);
}
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const windMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
const waveMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });

// box whose UVs are in world units, so tile textures repeat instead of stretching
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
  }
  return g;
}
function addBox(parent, w, h, d, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

// ===========================================================================
// World pieces
// ===========================================================================
function buildIsland(parent, isl, rnd, style) {
  const { x, z, w, d, y } = isl;
  const cx = x + w / 2, cz = z + d / 2;
  addBox(parent, w, 1, d, style === 'crumble' ? crackMats : slabMats, cx, y - 0.5, cz);

  // tapering rock body underneath (special platforms get a shorter stub)
  const m = Math.min(w, d) / 2;
  const insets = style === 'grass' ? [0.12, 0.36, 0.62, 0.84] : [0.18, 0.55];
  let top = y - 1;
  for (let i = 0; i < insets.length; i++) {
    const inset = insets[i] * m;
    const lw = w - inset * 2, ld = d - inset * 2;
    if (lw < 0.5 || ld < 0.5) break;
    const lh = 0.7 + m * (0.35 + 0.1 * i) * (0.8 + rnd() * 0.4);
    const jx = (rnd() - 0.5) * inset * 0.5, jz = (rnd() - 0.5) * inset * 0.5;
    addBox(parent, lw, lh, ld, M.rock, cx + jx, top - lh / 2, cz + jz);
    top -= lh;
  }

  if (style === 'move') {
    // glowing levitation crystals mark the islands that travel
    addBox(parent, 0.3, 0.6, 0.3, glow(0x6fe3ff), x + 0.5, y - 1.35, z + d - 0.35, false);
    addBox(parent, 0.3, 0.6, 0.3, glow(0x6fe3ff), x + w - 0.5, y - 1.35, z + d - 0.35, false);
    addBox(parent, 0.3, 0.3, 0.3, glow(0x6fe3ff), x + w - 0.35, y - 1.2, z + 0.5, false);
  }
  if (style === 'crumble') return;

  // vines hanging over the two faces the camera sees
  const vines = Math.round((w + d) / 3);
  for (let i = 0; i < vines; i++) {
    const len = 0.4 + rnd() * 1.1;
    const col = rnd() < 0.5 ? 0x3f8a35 : 0x4f9a3a;
    if (rnd() < 0.5) {
      addBox(parent, 0.18, len, 0.06, flat(col), x + 0.3 + rnd() * (w - 0.6), y - 0.25 - len / 2, z + d + 0.03, false);
    } else {
      addBox(parent, 0.06, len, 0.18, flat(col), x + w + 0.03, y - 0.25 - len / 2, z + 0.3 + rnd() * (d - 0.6), false);
    }
  }
}

function addTree(parent, x, y, z, rnd, colliders) {
  const s = 0.9 + rnd() * 0.45;
  const th = 1.7 * s;
  addBox(parent, 0.42 * s, th, 0.42 * s, M.bark, x, y + th / 2, z);
  let cy = y + th - 0.15;
  [2.3, 1.85, 1.35, 0.8].forEach((sz, i) => {
    const h = 0.8 * s;
    const b = addBox(parent, sz * s, h, sz * s, i % 2 ? M.leavesLight : M.leaves, x, cy + h / 2, z);
    b.rotation.y = i % 2 ? Math.PI / 4 : 0;
    cy += h * 0.82;
  });
  if (colliders) {
    colliders.push({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28, minY: y, maxY: y + 9, ground: false, off: false });
  }
}

function addProp(parent, x, y, z, rnd) {
  const k = rnd();
  if (k < 0.3) {          // mushroom
    addBox(parent, 0.12, 0.2, 0.12, flat(0xf1ead9), x, y + 0.1, z);
    addBox(parent, 0.32, 0.14, 0.32, flat(rnd() < 0.5 ? 0xd9453f : 0xe07a3a), x, y + 0.27, z);
  } else if (k < 0.6) {   // flower
    addBox(parent, 0.06, 0.28, 0.06, flat(0x3b7d2c), x, y + 0.14, z, false);
    addBox(parent, 0.18, 0.14, 0.18, flat([0xf2e36b, 0xf5f5f0, 0xe0568c][(rnd() * 3) | 0]), x, y + 0.33, z, false);
  } else if (k < 0.8) {   // rock
    const r = addBox(parent, 0.45, 0.28, 0.38, flat(0x857468), x, y + 0.14, z);
    r.rotation.y = rnd() * Math.PI;
  } else {                // grass tuft
    const a = addBox(parent, 0.4, 0.3, 0.06, flat(0x6dbb4c), x, y + 0.15, z, false);
    const b = addBox(parent, 0.06, 0.3, 0.4, flat(0x5fae45), x, y + 0.15, z, false);
    a.rotation.y = b.rotation.y = rnd();
  }
}

function addLantern(parent, x, y, z) {
  addBox(parent, 0.12, 1.5, 0.12, flat(0x4a2f1f), x, y + 0.75, z);
  addBox(parent, 0.3, 0.3, 0.3, glow(0xffd678), x, y + 1.65, z, false);
  const light = new THREE.PointLight(0xffc870, 9, 8);
  light.position.set(x, y + 1.7, z);
  parent.add(light);
}

function buildFlag(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  addBox(g, 0.4, 0.14, 0.4, flat(0x857468), 0, 0.07, 0);
  addBox(g, 0.14, 3.2, 0.14, flat(0x5b3a29), 0, 1.6, 0);
  const cloth = new THREE.Group();
  cloth.position.set(0.07, 2.8, 0);
  const mesh = addBox(cloth, 1.1, 0.7, 0.06, flat(0xd9453f), 0.55, 0, 0);
  g.add(cloth);
  parent.add(g);
  return { cloth, mesh };
}

function buildCabin(parent, x, y, z, colliders) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const W = 3.2, HH = 2, D = 2.8;
  addBox(g, W, HH, D, M.plank, 0, HH / 2, 0);
  const s = W / Math.SQRT2;
  const gable = addBox(g, s, s, D - 0.02, M.plank, 0, HH, 0);
  gable.rotation.z = Math.PI / 4;
  for (const side of [-1, 1]) {
    const r = addBox(g, s + 0.45, 0.2, D + 0.6, M.roof, side * (W / 4 + 0.21), HH + W / 4 - 0.07, 0);
    r.rotation.z = -side * Math.PI / 4;
  }
  addBox(g, 0.75, 1.25, 0.08, flat(0x4a2f1f), 0.55, 0.63, D / 2 + 0.03);
  addBox(g, 0.7, 0.7, 0.08, flat(0x6e4a2d), -0.8, 1.2, D / 2 + 0.02);
  addBox(g, 0.5, 0.5, 0.08, glow(0xffd678), -0.8, 1.2, D / 2 + 0.05, false);
  addBox(g, 0.45, 1.2, 0.45, M.rock, 0.85, HH + 1.25, -0.5);
  const lamp = new THREE.PointLight(0xffc870, 10, 7);
  lamp.position.set(-0.8, 1.3, D / 2 + 0.9);
  g.add(lamp);
  addBox(g, 0.12, 1.5, 0.12, flat(0x4a2f1f), -2.4, 0.75, 2.2);
  addBox(g, 0.3, 0.3, 0.3, glow(0xffd678), -2.4, 1.65, 2.2, false);
  parent.add(g);
  colliders.push({ minX: x - W / 2, maxX: x + W / 2, minZ: z - D / 2, maxZ: z + D / 2, minY: y, maxY: y + 9, ground: false, off: false });
  return { x: x + 0.85, y: y + HH + 1.9, z: z - 0.5 };   // chimney top, for smoke
}

// --- traps ------------------------------------------------------------------
const coneGeo = new THREE.ConeGeometry(0.17, 0.46, 4);
function buildSpikes(parent, s) {
  const [x, z, w, d, y, o = {}] = s;
  addBox(parent, w, 0.06, d, flat(0x3a3540), x + w / 2, y + 0.03, z + d / 2, false);
  const g = new THREE.Group();
  for (let px = x + 0.25; px < x + w - 0.05; px += 0.45) for (let pz = z + 0.25; pz < z + d - 0.05; pz += 0.45) {
    const m = new THREE.Mesh(coneGeo, flat(0xd0d4e0));
    m.position.set(px, y + 0.23, pz);
    m.rotation.y = Math.PI / 4;
    m.castShadow = true;
    g.add(m);
  }
  parent.add(g);
  return { minX: x, maxX: x + w, minZ: z, maxZ: z + d, y, period: o.period || 0, phase: o.phase || 0, g, up: 1 };
}

function buildPad(parent, p) {
  const [x, z, y, power] = p;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  addBox(g, 0.5, 0.3, 0.5, flat(0xf1ead9), 0, 0.15, 0);
  const cap = new THREE.Group();
  cap.position.y = 0.3;
  addBox(cap, 1.3, 0.3, 1.3, flat(0xd9453f), 0, 0.15, 0);
  for (const [dx, dz] of [[-0.35, -0.3], [0.3, 0.35], [0.35, -0.35], [-0.3, 0.3]]) {
    addBox(cap, 0.22, 0.06, 0.22, flat(0xfff3e0), dx, 0.32, dz, false);
  }
  g.add(cap);
  parent.add(g);
  return { x, z, y, power, cap, squash: 0 };
}

function buildWind(parent, w) {
  const zone = {
    minX: w.x, maxX: w.x + w.w, minZ: w.z, maxZ: w.z + w.d, minY: w.y, maxY: w.y + w.h,
    dx: w.dir[0], dz: w.dir[1], push: w.push, period: w.period, duty: w.duty, phase: w.phase || 0, s: 0, streaks: []
  };
  const alongX = Math.abs(zone.dx) > Math.abs(zone.dz);
  for (let i = 0; i < 14; i++) {
    zone.streaks.push(addBox(parent, alongX ? 1.1 : 0.05, 0.05, alongX ? 0.05 : 1.1, windMat,
      zone.minX + Math.random() * w.w, zone.minY + 0.5 + Math.random() * Math.min(5, w.h - 0.5), zone.minZ + Math.random() * w.d, false));
  }
  return zone;
}

// --- enemies ----------------------------------------------------------------
function addLegs(g, color, spread) {
  g.userData.legs = [[-spread, spread], [spread, spread], [-spread, -spread], [spread, -spread]]
    .map(([lx, lz]) => addBox(g, 0.22, 0.26, 0.22, flat(color), lx, 0.13, lz));
}
function makeWalker() {
  const g = new THREE.Group();
  addBox(g, 0.9, 0.7, 0.9, flat(0x3d2b4a), 0, 0.57, 0);
  addBox(g, 0.2, 0.3, 0.2, flat(0x2a1c33), -0.28, 1.03, 0.1);
  addBox(g, 0.2, 0.3, 0.2, flat(0x2a1c33), 0.28, 1.03, 0.1);
  addBox(g, 0.16, 0.16, 0.06, glow(0xff5a3c), -0.2, 0.68, 0.46, false);
  addBox(g, 0.16, 0.16, 0.06, glow(0xff5a3c), 0.2, 0.68, 0.46, false);
  addLegs(g, 0x2a1c33, 0.26);
  return g;
}
function makeFlyer() {
  const g = new THREE.Group();
  addBox(g, 0.7, 0.5, 0.7, flat(0x5a3a66), 0, 0, 0);
  addBox(g, 0.14, 0.14, 0.06, glow(0xff5a3c), -0.17, 0.05, 0.36, false);
  addBox(g, 0.14, 0.14, 0.06, glow(0xff5a3c), 0.17, 0.05, 0.36, false);
  addBox(g, 0.2, 0.2, 0.3, flat(0x3d2b4a), 0, -0.05, -0.45);
  g.userData.wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.35, 0.12, 0);
    addBox(pivot, 0.7, 0.06, 0.45, flat(0x8a6aa8), side * 0.35, 0, 0);
    g.add(pivot);
    return pivot;
  });
  return g;
}
// lunges at the raccoon: crimson, horned, yellow-eyed so it reads as a different threat
function makeChaser() {
  const g = new THREE.Group();
  addBox(g, 0.95, 0.7, 1.0, flat(0x5a1f36), 0, 0.57, 0);
  addBox(g, 0.5, 0.2, 0.5, flat(0x7a2a48), 0, 1.0, -0.1);
  addBox(g, 0.14, 0.4, 0.14, flat(0xffa23c), -0.3, 1.1, 0.25);
  addBox(g, 0.14, 0.4, 0.14, flat(0xffa23c), 0.3, 1.1, 0.25);
  addBox(g, 0.2, 0.14, 0.06, glow(0xffe04a), -0.22, 0.7, 0.51, false);
  addBox(g, 0.2, 0.14, 0.06, glow(0xffe04a), 0.22, 0.7, 0.51, false);
  addBox(g, 0.5, 0.1, 0.06, glow(0xfff0c0), 0, 0.42, 0.51, false);
  addLegs(g, 0x3a1424, 0.28);
  return g;
}
// rooted turret that spits slow orbs
function makeSpitter() {
  const g = new THREE.Group();
  addBox(g, 0.9, 0.16, 0.9, flat(0x24503a), 0, 0.08, 0);
  addBox(g, 0.3, 0.7, 0.3, flat(0x2f6a48), 0, 0.45, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.95, 0);
  addBox(head, 0.8, 0.7, 0.8, flat(0x4a2a5a), 0, 0, 0);
  addBox(head, 0.4, 0.3, 0.1, glow(0xff4fd8), 0, -0.05, 0.42, false);
  addBox(head, 0.14, 0.14, 0.06, glow(0xff5a3c), -0.24, 0.2, 0.41, false);
  addBox(head, 0.14, 0.14, 0.06, glow(0xff5a3c), 0.24, 0.2, 0.41, false);
  addBox(head, 0.16, 0.3, 0.16, flat(0x2a1c33), -0.2, 0.45, 0);
  addBox(head, 0.16, 0.3, 0.16, flat(0x2a1c33), 0.2, 0.45, 0);
  g.add(head);
  g.userData.head = head;
  return g;
}
function makeBoss(mini) {
  const g = new THREE.Group();
  const dark = 0x2a1c33;
  addBox(g, 1.0, 0.8, 1.0, flat(mini ? 0x3d2b4a : 0x33203f), 0, 0.62, 0);
  addBox(g, 0.7, 0.3, 0.7, flat(dark), 0, 1.12, -0.05);
  addBox(g, 0.16, 0.45, 0.16, flat(0xffa23c), -0.36, 1.2, 0.2);
  addBox(g, 0.16, 0.45, 0.16, flat(0xffa23c), 0.36, 1.2, 0.2);
  addBox(g, 0.22, 0.18, 0.06, glow(0xff3838), -0.24, 0.8, 0.51, false);
  addBox(g, 0.22, 0.18, 0.06, glow(0xff3838), 0.24, 0.8, 0.51, false);
  addBox(g, 0.6, 0.14, 0.06, glow(0xfff0c0), 0, 0.42, 0.51, false);
  if (!mini) for (const cx of [-0.2, 0, 0.2]) addBox(g, 0.12, 0.25, 0.12, flat(0xe8b23c), cx, 1.4, -0.05);
  g.userData.legs = [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]]
    .map(([lx, lz]) => addBox(g, 0.28, 0.3, 0.28, flat(dark), lx, 0.15, lz));
  g.scale.setScalar(mini ? 1.7 : 2.4);
  return g;
}

// friendly character: an old owl on a stump, with a "!" hovering until the raccoon comes close
function makeOwl() {
  const g = new THREE.Group();
  addBox(g, 0.9, 0.45, 0.9, M.bark, 0, 0.225, 0);
  const bird = new THREE.Group();
  bird.position.y = 0.45;
  addBox(bird, 0.7, 0.75, 0.6, flat(0x8a6a4a), 0, 0.42, 0);
  addBox(bird, 0.44, 0.5, 0.06, flat(0xe0cfa8), 0, 0.36, 0.31, false);
  addBox(bird, 0.14, 0.55, 0.45, flat(0x6b4f36), -0.42, 0.42, 0);
  addBox(bird, 0.14, 0.55, 0.45, flat(0x6b4f36), 0.42, 0.42, 0);
  addBox(bird, 0.2, 0.08, 0.25, flat(0xe8a23c), -0.18, 0.04, 0.2);
  addBox(bird, 0.2, 0.08, 0.25, flat(0xe8a23c), 0.18, 0.04, 0.2);
  const head = new THREE.Group();
  head.position.y = 1.05;
  addBox(head, 0.8, 0.55, 0.65, flat(0x9a7a56), 0, 0, 0);
  addBox(head, 0.16, 0.24, 0.16, flat(0x6b4f36), -0.32, 0.36, 0);
  addBox(head, 0.16, 0.24, 0.16, flat(0x6b4f36), 0.32, 0.36, 0);
  const eyes = [-0.2, 0.2].map(ex => addBox(head, 0.26, 0.26, 0.06, glow(0xffe04a), ex, 0.04, 0.33, false));
  addBox(head, 0.1, 0.1, 0.06, flat(0x2a1f18), -0.2, 0.04, 0.36, false);
  addBox(head, 0.1, 0.1, 0.06, flat(0x2a1f18), 0.2, 0.04, 0.36, false);
  addBox(head, 0.12, 0.14, 0.12, flat(0xe8a23c), 0, -0.1, 0.36, false);
  bird.add(head);
  g.add(bird);
  const mark = new THREE.Group();
  addBox(mark, 0.16, 0.42, 0.16, glow(0xffd23f), 0, 0.2, 0, false);
  addBox(mark, 0.16, 0.14, 0.16, glow(0xffd23f), 0, -0.16, 0, false);
  g.add(mark);
  g.userData = { bird, head, eyes, mark };
  return g;
}

const blobGeo = new THREE.CircleGeometry(0.5, 10);
blobGeo.rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x10202a, transparent: true, opacity: 0.38, depthWrite: false });
function makeBlob() {
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.renderOrder = 1;
  return m;
}

// ===========================================================================
// Clouds and weather
// ===========================================================================
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x52687a });
const clouds = [];
const cloudBounds = { minX: -40, maxX: 80 };
(function buildClouds() {
  const rnd = mulberry32(4242);
  for (let i = 0; i < 54; i++) {
    const g = new THREE.Group();
    const w = 4 + rnd() * 4, d = 2.5 + rnd() * 2, h = 1.1 + rnd() * 0.7;
    addBox(g, w, h, d, cloudMat, 0, 0, 0, false);
    const puffs = 2 + ((rnd() * 3) | 0);
    for (let k = 0; k < puffs; k++) {
      const pw = w * (0.3 + rnd() * 0.35);
      addBox(g, pw, h * (0.6 + rnd() * 0.5), d * (0.5 + rnd() * 0.4), cloudMat,
        (rnd() - 0.5) * (w - pw), h * (0.45 + rnd() * 0.3), (rnd() - 0.5) * d * 0.4, false);
    }
    scene.add(g);
    clouds.push({ g, speed: 0.25 + rnd() * 0.5, r: [rnd(), rnd(), rnd()], north: i % 4 === 0 });
  }
})();
function placeClouds(b) {
  cloudBounds.minX = b.minX - 38;
  cloudBounds.maxX = b.maxX + 38;
  for (const c of clouds) {
    const x = cloudBounds.minX + c.r[0] * (cloudBounds.maxX - cloudBounds.minX);
    if (c.north) {
      c.g.position.set(x, b.minY - 7 + c.r[1] * 9, b.minZ - 12 - c.r[2] * 20);
    } else {
      c.g.position.set(x, b.minY - 9 - c.r[1] * 15, b.minZ - 34 + c.r[2] * (b.maxZ - b.minZ + 58));
    }
  }
}

const rainGroup = new THREE.Group();
const rain = [];
(function buildRain() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xaab8dc, transparent: true, opacity: 0.55 });
  const geo = new THREE.BoxGeometry(0.03, 0.6, 0.03);
  for (let i = 0; i < 110; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.z = 0.18;
    rainGroup.add(m);
    rain.push({ m, ox: (Math.random() - 0.5) * 40, oz: (Math.random() - 0.5) * 26, y: Math.random() * 22 - 7, sp: 20 + Math.random() * 8 });
  }
  rainGroup.visible = false;
  scene.add(rainGroup);
})();

const fireflyGroup = new THREE.Group();
const fireflies = [];
(function buildFireflies() {
  const geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(geo, glow(0xd8ff7a));
    fireflyGroup.add(m);
    fireflies.push({ m, ax: 0, ay: 0, az: 0, ph: Math.random() * 20 });
  }
  fireflyGroup.visible = false;
  scene.add(fireflyGroup);
})();
let lightningT = 4, lightningFlash = 0;

function applyTheme(i) {
  theme = THEMES[i];
  paintSky(theme.sky, theme.stars);
  scene.fog.color.setHex(theme.fog);
  hemi.color.setHex(theme.hemiSky);
  hemi.groundColor.setHex(theme.hemiGround);
  hemi.intensity = theme.hemiI;
  sun.color.setHex(theme.sun);
  sun.intensity = theme.sunI;
  sunDir.set(...theme.sunDir).normalize();
  cloudMat.color.setHex(theme.cloud);
  cloudMat.emissive.setHex(theme.cloudE);
  spriteTint.setHex(theme.tint);
  rainGroup.visible = !!theme.rain;
  fireflyGroup.visible = !!theme.fireflies;
  music.theme = MUSIC[i];
  lightningT = 3;
  lightningFlash = 0;
  flashEl.style.opacity = 0;
}

// ===========================================================================
// Levels. Islands are [x, z, width, depth, topY, options]; +x is the way forward.
// Options: move {axis, dist, period} · crumble · gate (appears when the boss falls) · bare (no trees)
// ===========================================================================
const LEVELS = [
  { // 1: tutorial — movement, dash, a travelling island and a bounce pad to the first secret
    name: 'Ранковий ліс', theme: 0, par: 40, spawn: [-1, 0, 0],
    islands: [
      [-4, -4, 10, 8, 0], [8.5, -2, 5, 4, 0], [18.5, -2, 4, 4, 0],
      [25.5, -1.5, 3, 3, 0.5, { move: { axis: 'x', dist: 4, period: 5 } }],
      [33, -3, 3, 3, 1.5], [38.5, -1.5, 3, 3, 3], [44, -5, 9, 9, 4],
      [9.5, 4.5, 3, 3, 3.5]
    ],
    discs: [[1, 1.5, 0], [4, -1.5, 0], [11, -0.5, 0], [20.5, 0, 0], [34.5, -1.5, 1.5], [40, 0, 3]],
    gems: [[15, 0, 0.4], [16.5, 0, 0.4], [47, 2, 4], [48.5, -3, 4], [10.3, 5.5, 3.5, 5], [11.7, 5.5, 3.5, 5]],
    powerups: [['magnet', 11, 6.7, 3.5]],
    pads: [[11, 1.2, 0, 16]],
    secret: [11, 6, 3.5, 1.6],
    hints: [
      { x: -1, z: 0, r: 3, text: 'WASD — рух · Пробіл — стрибок, ще раз у повітрі — подвійний' },
      { x: 11.5, z: -0.5, r: 1.7, text: 'Shift або E — ривок: перелітай широкі прірви' },
      { x: 20.5, z: 0, r: 1.8, text: 'F — постріл · утримуй F для зарядженого' }
    ],
    enemies: [],
    goal: [50.5, -0.5, 4]
  },
  { // 2: first shadow creatures, crumbling slabs, spikes
    name: 'Тінь у видолинку', theme: 1, par: 55, spawn: [-1.5, 0, 0],
    islands: [
      [-4, -3, 9, 6, 0], [7.5, -2, 4, 4, 0],
      [13.5, -1.2, 2.5, 2.5, 0, { crumble: true }], [18, -1.5, 2.5, 2.5, 0.5, { crumble: true }], [22.5, -1.2, 2.5, 2.5, 1, { crumble: true }],
      [27, -4, 14, 8, 0.5], [43.5, -2.5, 5, 5, 1.5],
      [8, -7.5, 3, 3, 1.5], [13, -9.5, 3, 3, 3]
    ],
    discs: [[1, 1.5, 0], [3.5, -1.5, 0], [9.5, 0, 0], [9.5, -6, 1.5], [30, -2.5, 0.5], [39, 2.8, 0.5], [33, 3, 0.5]],
    gems: [[14.7, 0, 0], [19.2, -0.3, 0.5], [23.7, 0, 1], [36, -3, 0.5], [45, -1.5, 1.5], [14, -8.6, 3, 5]],
    powerups: [['shield', 40, -2.5, 0.5], ['heart', 15.2, -7.6, 3]],
    spikes: [[35, 1.2, 3, 1.6, 0.5]],
    secret: [14.5, -8, 3, 1.6],
    hints: [
      { x: 9.5, z: 0, r: 1.6, text: 'Сірі плити кришаться — не стій на місці!' },
      { x: 28.5, z: 0, r: 2, text: 'Червоні з рогами кидаються ривком — ухиляйся власним або клич клонів (Q)' }
    ],
    enemies: [
      { type: 'walker', a: [29.5, 0.8], b: [33.5, 0.8], y: 0.5, speed: 1.8 },
      { type: 'chaser', at: [38, -1.2], y: 0.5 }
    ],
    goal: [46.5, 0, 1.5]
  },
  { // 3: lifts, gusting wind, spitters and a mini-boss guarding the flag
    name: 'Скелясті прірви', theme: 2, par: 90, spawn: [-1, 0, 0],
    islands: [
      [-3, -3, 7, 6, 0], [6.5, -1.5, 3, 3, 1],
      [12, -1.5, 3, 3, 2.2, { move: { axis: 'y', dist: 3, period: 4.5 } }],
      [17.5, -3, 3, 3, 3.5], [24.5, -2.5, 3.5, 3.5, 3], [31, -4, 8, 7, 2], [41.5, -2, 3, 3, 3.5],
      [47, -6, 11, 11, 4.5, { bare: true }],
      [33, 5.5, 3, 3, -1.5]
    ],
    discs: [[8, 0, 1], [19, -1.5, 3.5], [26.2, -0.8, 3], [33, -2.5, 2], [37.5, 1.5, 2], [43, -0.5, 3.5], [49, -4.5, 4.5], [49, 3.5, 4.5], [56, 3.5, 4.5]],
    gems: [[13.5, 0, 2.5], [22.5, -1, 3.6], [35, 1, 2], [33.8, 6.2, -1.5, 5], [35.2, 6.2, -1.5, 5]],
    powerups: [['speed', 35.5, -1, 2], ['heart', 33.6, 8, -1.5]],
    spikes: [[33.5, -3.8, 2, 2, 2, { period: 2.6 }]],
    pads: [[34.6, 7.2, -1.5, 17.5]],
    wind: [{ x: 20.5, z: -4.5, w: 4, d: 7, y: 1, h: 8, dir: [0, 1], push: 3.2, period: 4, duty: 0.5 }],
    secret: [34.5, 7, -1.5, 1.6],
    hints: [
      { x: 8, z: 0, r: 1.5, text: 'Острови з блакитними кристалами рухаються — лови момент' },
      { x: 19, z: -1.5, r: 1.5, text: 'Вітер зносить у стрибку — перечекай порив або пролети ривком' }
    ],
    enemies: [
      { type: 'walker', a: [32.5, 0.5], b: [37.5, 0.5], y: 2, speed: 2.2 },
      { type: 'spitter', at: [37.8, -3], y: 2 },
      { type: 'boss', at: [53, -0.5], y: 4.5, mini: true }
    ],
    goal: [56.5, -4.5, 4.5]
  },
  { // 4: night — retracting spikes, flyers, a drifting ferry and a pad up to the flag
    name: 'Нічні духи', theme: 3, par: 95, spawn: [-1.5, 0, 0],
    islands: [
      [-3, -4, 10, 8, 0], [9.5, -3, 7, 6, 0],
      [19, -1, 2.5, 2.5, 1, { crumble: true }], [23.5, -2.2, 2.5, 2.5, 2, { crumble: true }],
      [28.5, -1.5, 3, 3, 3],
      [34, -1.5, 3, 3, 3, { move: { axis: 'z', dist: 6, period: 5.5 } }],
      [40, -5, 13, 10, 2.5], [55.5, -2, 5, 5, 6],
      [29, -8.5, 3, 3, 4.5]
    ],
    discs: [[0, 2.5, 0], [5.5, -2.5, 0], [13, 0, 0], [29.3, 0.6, 3], [42, -3.5, 2.5], [47, 3.5, 2.5], [50, -1, 2.5]],
    gems: [[12.9, 2, 0], [20.2, 0.2, 1], [24.7, -1, 2], [35.5, 0, 3.4], [45, 0, 2.5], [29.8, -7.6, 4.5, 5], [31.2, -7.6, 4.5, 5]],
    powerups: [['triple', 30.6, -0.5, 3], ['heart', 30.5, -6.4, 4.5]],
    spikes: [[11, -3, 1.4, 6, 0, { period: 2.8, phase: 0 }], [14, -3, 1.4, 6, 0, { period: 2.8, phase: 0.5 }]],
    pads: [[52, 0.5, 2.5, 17]],
    secret: [30.5, -7, 4.5, 1.6],
    hints: [{ x: 10, z: 0, r: 1.3, text: 'Шипи ховаються й вистрілюють — лови ритм або проскакуй ривком' }],
    enemies: [
      { type: 'chaser', at: [4.5, 1], y: 0 },
      { type: 'flyer', a: [19.5, 0.5], b: [26, -1.5], y: 3.1, speed: 2.2, phase: 0 },
      { type: 'chaser', at: [46, 0], y: 2.5 },
      { type: 'spitter', at: [51, -4], y: 2.5 },
      { type: 'flyer', a: [41, -3], b: [48, 3], y: 3.6, speed: 2.6, phase: 2 },
      { type: 'walker', a: [43, 3.8], b: [49.5, 3.8], y: 2.5, speed: 2.4 }
    ],
    goal: [58, 0.5, 6]
  },
  { // 5: storm — everything at once, then the boss; the bridge home rises when it falls
    name: 'Буря над вершиною', theme: 4, par: 170, spawn: [-1.5, 0, 0],
    islands: [
      [-3, -3, 8, 6, 0], [7.5, -3, 6, 6, 0], [16, -1.5, 3, 3, 1.2], [21.5, -3.5, 3, 3, 2.4],
      [27, -1.5, 3, 3, 3.4, { move: { axis: 'y', dist: 2.4, period: 4 } }],
      [32.5, -4, 3.5, 3.5, 4.8],
      [38.5, -2, 2.5, 2.5, 4.2, { crumble: true }], [43, -1, 2.5, 2.5, 3.6, { crumble: true }],
      [47.5, -3, 5, 6, 3],
      [55, -7, 13, 13, 3.5, { bare: true }],
      [70, -1.5, 2.5, 2.5, 4.6, { gate: true }], [74.5, -1.5, 2.5, 2.5, 5.8, { gate: true }],
      [79, -6, 12, 12, 7],
      [33, -9, 3, 3, 6]
    ],
    discs: [[0, -2, 0], [9, 2, 0], [17.5, 0, 1.2], [23, -2, 2.4], [34.2, -2.2, 4.8], [48.5, -2, 3], [50, 0, 3], [51.5, 2, 3],
      [57, -5.5, 3.5], [57, 4.5, 3.5], [66, -5.5, 3.5], [66, 4.5, 3.5], [61.5, -6, 3.5]],
    gems: [[12.5, -2, 0], [28.5, 0, 4.2], [39.7, -0.8, 4.2], [44.2, 0.2, 3.6], [33.8, -8, 6, 5], [35.2, -8, 6, 5], [84, 3.8, 7], [85.5, 3.8, 7]],
    powerups: [['shield', 49, 1.5, 3], ['triple', 51.5, -1.8, 3], ['heart', 34.5, -7, 6]],
    spikes: [[10, -3, 1.4, 6, 0, { period: 2.6 }]],
    wind: [{ x: 13.5, z: -5.5, w: 8, d: 8.5, y: 0, h: 9, dir: [0, -1], push: 3, period: 4.4, duty: 0.5 }],
    secret: [34.5, -7.5, 6, 1.6],
    hints: [{ x: 50, z: 0, r: 2.2, text: 'Попереду бос. Запасайся дисками — заряджений постріл б’є втричі сильніше' }],
    enemies: [
      { type: 'walker', a: [2.5, -2.2], b: [2.5, 2.2], y: 0, speed: 2.2 },
      { type: 'chaser', at: [12.5, 0.5], y: 0 },
      { type: 'flyer', a: [20, -2.5], b: [29, 0], y: 3.9, speed: 2.4, phase: 0 },
      { type: 'spitter', at: [35.2, -3.3], y: 4.8 },
      { type: 'flyer', a: [38, 0], b: [46, 0.5], y: 5.0, speed: 2.6, phase: 1.5 },
      { type: 'boss', at: [61.5, -0.5], y: 3.5 }
    ],
    cabin: [87, -1.5, 7],
    goal: [84.5, 2.5, 7]
  }
];

// ---------------------------------------------------------------------------
// The wandering owl: a character with a name plate who turns up several times
// per run, on random levels and islands, and never says the same thing twice.
// ---------------------------------------------------------------------------
const NPC_NAME = 'Старий Пугач';
const NPC_TEXTS = [
  'Пугу-пугу, мандрівнику! Тіні бояться блакитних дисків, а їхній Володар — заряджених. Бережи серця й не дивись униз.',
  'Сірі плити пам’ятають кожен крок. Став лапу — і вже біжи далі, бо вони кришаться.',
  'Червонооких із рогами не переженеш. Дочекайся кидка — і зроби ривок убік.',
  'Бачиш острови з блакитними кристалами? Вони мандрують. Мудрий єнот чекає, а не стрибає навмання.',
  'На кожному рівні є схованка. Шукай батути й острови осторонь від стежки — там великі кристали.',
  'Вартовий розганяється, мов буря. Стань біля краю, відскоч — і бий, поки він крутить головою.',
  'Вітер тут дме поривами. Порахуй до двох — і стрибай у тишу.',
  'Кристали не їдять, їх несуть у крамницю. Зайве серце ще нікому не завадило.',
  'Я літав над вершиною: у хатинці горить світло. Хтось дуже чекає на тебе вдома.',
  'Шипи ховаються й вистрілюють у ритмі. Слухай їх, як пісню, — або пролітай ривком.',
  'Колись ці острови були однією горою. Тіні розкололи її, а ти збираєш докупи.',
  'Плювачі ліниві: стріляють рідко й повільно. Їхню кулю можна збити диском.'
];
// decided once per run: which levels the owl visits and what it says there
function planNpcs() {
  const texts = NPC_TEXTS.slice();
  for (let i = texts.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  const plan = LEVELS.map(() => []);
  const order = LEVELS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  const visits = 2 + ((Math.random() * 2) | 0);   // 2–3 meetings per run, each on a different level
  for (let k = 0; k < visits; k++) plan[order[k % order.length]].push(texts[k]);
  return plan;
}
const npcPlan = planNpcs();

// ---------------------------------------------------------------------------
// The hero himself: once or twice per run the raccoon pops up at the edge of
// the screen, at a random moment early in a random level, with a remark.
// ---------------------------------------------------------------------------
const HERO_TEXTS = [
  'Так, мапа каже: «тут дракони». Драконів не бачу — уже добре!',
  'Хвіст трубою, диски в рюкзак — і вперед!',
  'Хто розкидав тут стільки островів? Я ж тільки-но розклав мапу…',
  'Якщо впаду — скажіть сові, що це був тактичний маневр.',
  'Компас показує на хатинку. Або на обід. Сподіваюсь, це одне й те саме.',
  'Тіні, начувайтеся: у мене диски й дуже серйозний погляд.',
  'Пам’ятка собі: не дивитися вниз. …Я подивився вниз.',
  'Ще трохи — і вдома. Там чай, плед і жодних шипів.',
  'Рожева бандана — на удачу. Поки що працює!',
  'Джутсу тіньового клонування! …Тобто я і ще двоє таких самих гарних.',
  'Цей острів точно був на мапі. Мабуть. Десь під плямою від чаю.'
];
// level index -> remark, decided once per run
function planHero() {
  const plan = {};
  const count = 1 + ((Math.random() * 2) | 0);   // one or two levels
  const texts = HERO_TEXTS.slice();
  while (Object.keys(plan).length < count) {
    const li = (Math.random() * LEVELS.length) | 0;
    if (!(li in plan)) plan[li] = texts.splice((Math.random() * texts.length) | 0, 1)[0];
  }
  return plan;
}
const heroPlan = planHero();
let heroTimer = 0, heroHideT = 0;

function showHero(text) {
  heroTextEl.textContent = text;
  heroPopEl.className = 'in';
  heroHideT = 5;
  sfxHeroPop();
}
function hideHero() {
  heroHideT = 0;
  heroPopEl.className = 'hidden';
}
function updateHero(dt) {
  if (heroTimer > 0 && mode === 'playing') {
    heroTimer -= dt;
    if (heroTimer <= 0) {
      if (toastT > 0) heroTimer = 0.5;   // let a hint finish first: they share the bottom of the screen
      else showHero(heroPlan[levelIndex]);
    }
  }
  if (heroHideT > 0) {
    heroHideT -= dt;
    if (heroHideT <= 0) hideHero();
    else if (heroHideT < 0.3) heroPopEl.className = 'out';
  }
}

// ===========================================================================
// Game state
// ===========================================================================
const SPEED = 5.6, ACCEL = 42, FRICTION = 48;
const GRAVITY = 30, JUMP_V = 11, DJUMP_V = 9.6, MAX_FALL = 26;
const MAX_AIR_JUMPS = 1;
const PR = 0.32, PH = 1.6;   // player collision radius / height
const STEP = 0.4;            // ledge forgiveness when a jump lands slightly short
const DASH_SPEED = 17, DASH_TIME = 0.16, DASH_GRACE = 0.1;
const COYOTE = 0.1, JUMP_BUFFER = 0.12;
const CHARGE_TIME = 0.7, CHARGE_EXTRA = 2;
const BUFF_TIME = { triple: 15, magnet: 15, speed: 12 };
const BUFF_NAME = { shield: 'Щит', triple: 'Потрійний постріл', magnet: 'Магніт', speed: 'Швидкість', heart: '+1 життя', clone: 'Джутсу клонування!' };
// Shadow Clone Jutsu: cast with Q for chakra; two decoys that each take one hit, or fade after a while
const MAX_CLONES = 2, CLONE_COST = 50, CLONE_TIME = 15;
const ENERGY_MAX = 100, ENERGY_REGEN = 2, ENERGY_PER_KILL = 8;

const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 1, fz: 0, onGround: false, moving: false, ground: null };
// everything that carries over between levels
const run = { hearts: 3, maxHearts: 3, ammo: 0, gems: 0, score: 0, energy: ENERGY_MAX, stars: [], up: { fire: false, jump: false, dash: false } };
const buffs = { shield: false, triple: 0, magnet: 0, speed: 0, clones: 0, cloneT: 0 };
let stats = { time: 0, damaged: false, secret: false };
const combo = { count: 0, timer: 0 };

let airJumpsLeft = 0, jumpKeyPrev = false, dashKeyPrev = false, fPrev = false, castKeyPrev = false;
let invulnTimer = 0, shootCooldown = 0, coyote = 0, jumpBuf = 0;
let dashT = 0, dashCd = 0, dashGrace = 0, airDashUsed = false, dashDX = 1, dashDZ = 0;
let chargeT = 0, chargeReady = false, stunT = 0;
let windX = 0, windZ = 0;
let squash = 0, runPhase = 0, lean = 0, hurtFlash = 0, ghostTimer = 0, stepFrame = 0;
let smokeTimer = 0, toastT = 0, lockToast = 0, buffHudT = 0, timerText = '';
let shakeT = 0, shakeDur = 1, shakeAmp = 0, freezeT = 0;
let checkpoint = { x: 0, y: 0, z: 0 };
let mode = 'loading';   // loading | menu | playing | shop | won | gameover
let levelIndex = 0, lt = 0;
let level = null;       // runtime data of the loaded level
const shots = [], orbs = [], waves = [], particles = [];

function shake(amp, dur) {
  if (shakeT <= 0 || amp >= shakeAmp) { shakeAmp = amp; shakeDur = shakeT = dur; }
}
function hitStop(s) { freezeT = Math.max(freezeT, s); }
const dashCooldown = () => (run.up.dash ? 0.45 : 0.75);
const isDashing = () => dashT > 0 || dashGrace > 0;

// ===========================================================================
// HUD
// ===========================================================================
function artCanvas(rows, palette) {
  const c = makeCanvas(Math.max(...rows.map(r => r.length)), rows.length);
  const g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1); }
  }));
  return c;
}
const imgTag = (c, scale) => `<img class="px" src="${c.toDataURL()}" width="${c.width * scale}" height="${c.height * scale}" alt="">`;

const HEART_ART = [
  '..##...##..',
  '.#rr#.#rr#.',
  '#rwrr#rrrr#',
  '#rrrrrrrrr#',
  '#rrrrrrrrr#',
  '.#rrrrrrr#.',
  '..#rrrrr#..',
  '...#rrr#...',
  '....#r#....',
  '.....#.....'
];
const GEM_ART = [
  '....#....',
  '...#w#...',
  '..#wyy#..',
  '.#wyyyo#.',
  '#wyyyyoo#',
  '#yyyyyoo#',
  '.#yyyoo#.',
  '..#yoo#..',
  '...#o#...',
  '....#....'
];
const POWER_ART = {
  shield: [[
    '.#########.',
    '#bbbbbbbbb#',
    '#bwwbbbbbb#',
    '#bwbbbbbbb#',
    '#bbbbbbbbb#',
    '#bbbbbbbbb#',
    '.#bbbbbbb#.',
    '.#bbbbbbb#.',
    '..#bbbbb#..',
    '...#bbb#...',
    '....###....'
  ], { '#': '#0e2a4a', b: '#3fa7ff', w: '#d6f0ff' }],
  triple: [[
    '....###....',
    '...#ccc#...',
    '...#cwc#...',
    '...#ccc#...',
    '.###.#.###.',
    '#ccc#.#ccc#',
    '#cwc#.#cwc#',
    '#ccc#.#ccc#',
    '.###...###.'
  ], { '#': '#0e2050', c: '#46a0f0', w: '#e6f6ff' }],
  magnet: [[
    '.###...###.',
    '#www#.#www#',
    '#www#.#www#',
    '#rrr#.#rrr#',
    '#rrr#.#rrr#',
    '#rrr###rrr#',
    '#rrrrrrrrr#',
    '.#rrrrrrr#.',
    '..#######..'
  ], { '#': '#3a0e14', r: '#e23b4a', w: '#f1ead9' }],
  speed: [[
    '.....####..',
    '....#yyy#..',
    '...#yyy#...',
    '..#yyy#....',
    '.#yyyy####.',
    '.####yyyy#.',
    '....#yyy#..',
    '...#yyy#...',
    '..#yyy#....',
    '..#yy#.....',
    '..###......'
  ], { '#': '#4a3200', y: '#ffd23f' }],
  heart: [HEART_ART, { '#': '#2a1a22', r: '#e23b4a', w: '#ffb3ba' }],
  // shadow-clone scroll: an orange swirl badge
  clone: [[
    '...#####...',
    '..#ooooo#..',
    '.#o#####o#.',
    '#o#ooooo#o#',
    '#o#o###o#o#',
    '#o#o#o#o#o#',
    '#o#ooo#o#o#',
    '#o#####o#o#',
    '.#ooooooo#.',
    '..#######..'
  ], { '#': '#7a2e00', o: '#ff9a2e' }]
};
const heartCanvas = artCanvas(HEART_ART, { '#': '#2a1a22', r: '#e23b4a', w: '#ffb3ba' });
const ICON_HEART = imgTag(heartCanvas, 3);
const ICON_HEART_EMPTY = imgTag(artCanvas(HEART_ART, { '#': '#2a1a22', r: '#4a3f55', w: '#5a4f66' }), 3);
const gemCanvas = artCanvas(GEM_ART, { '#': '#3a2208', w: '#fff3b0', y: '#ffd23f', o: '#e08a1e' });
const powerCanvas = {};
for (const k in POWER_ART) powerCanvas[k] = artCanvas(POWER_ART[k][0], POWER_ART[k][1]);
$('gemIcon').innerHTML = imgTag(gemCanvas, 3);

function renderHearts() {
  const h = Math.max(0, run.hearts);
  heartsEl.innerHTML = ICON_HEART.repeat(h) + ICON_HEART_EMPTY.repeat(Math.max(0, run.maxHearts - h));
}
function renderAmmo() { ammoCountEl.textContent = run.ammo; }
function renderGems() { gemCountEl.textContent = run.gems; }
function addScore(n) { run.score += n; scoreEl.textContent = run.score; }
function renderCombo() {
  comboEl.classList.toggle('hidden', combo.count < 2);
  if (combo.count >= 2) comboEl.textContent = `КОМБО x${Math.min(5, combo.count)}`;
}
function renderBuffs() {
  let html = '';
  if (buffs.shield) html += `<div class="buff">${imgTag(powerCanvas.shield, 2)}${BUFF_NAME.shield}</div>`;
  if (buffs.clones > 0) {
    html += `<div class="buff">${imgTag(powerCanvas.clone, 2)}×${buffs.clones}<span class="track"><span class="fill" style="width:${Math.round(buffs.cloneT / CLONE_TIME * 100)}%"></span></span></div>`;
  }
  for (const k of ['triple', 'magnet', 'speed']) {
    if (buffs[k] > 0) {
      html += `<div class="buff">${imgTag(powerCanvas[k], 2)}<span class="track"><span class="fill" style="width:${Math.round(buffs[k] / BUFF_TIME[k] * 100)}%"></span></span></div>`;
    }
  }
  buffsEl.innerHTML = html;
}
function renderBossBar() {
  const b = level && level.boss;
  const show = !!b && b.alive && b.awake;
  bossBarEl.classList.toggle('hidden', !show);
  if (show) {
    bossNameEl.textContent = b.mini ? 'Тіньовий Вартовий' : 'Тіньовий Володар';
    bossFillEl.style.width = `${Math.max(0, b.hp / b.maxHp * 100)}%`;
  }
}
function toast(text, dur = 3) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  toastT = dur;
}
// photo mode: grabs the rendered frame (HUD lives in DOM, not the canvas, so
// it's already excluded), frames it, and offers it as a PNG download
function takePhoto() {
  if (mode === 'loading' || mode === 'menu') return;
  const src = renderer.domElement;
  const PAD = 10, CAP = 36;
  const w = src.width + PAD * 2, h = src.height + PAD * 2 + CAP;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#161b26';
  g.fillRect(0, 0, w, h);
  g.drawImage(src, PAD, PAD);
  g.strokeStyle = '#e8b23c';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.textAlign = 'center';
  const name = LEVELS[levelIndex] ? LEVELS[levelIndex].name : '';
  g.fillStyle = '#ffd23f';
  g.font = 'bold 14px "Courier New", monospace';
  g.fillText(`Пригода Єнота-Дослідника · Рівень ${levelIndex + 1}: ${name}`, w / 2, PAD * 2 + src.height + 17);
  g.fillStyle = '#fff';
  g.font = '11px "Courier New", monospace';
  g.fillText(`${fmtTime(stats.time)}  ·  ${run.score} очок  ·  ${new Date().toLocaleDateString('uk-UA')}`, w / 2, PAD * 2 + src.height + 31);

  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `raccoon-adventure-${Date.now()}.png`;
  a.click();

  flashEl.style.opacity = 0.85;
  setTimeout(() => { flashEl.style.opacity = 0; }, 90);
  sfxShutter();
  toast('📸 Фото збережено!', 1.8);
}

function popup(text, x, y, z, cls) {
  const [sx, sy] = screenPos(x, y, z);
  const el = document.createElement('div');
  el.className = 'popup' + (cls ? ' ' + cls : '');
  el.textContent = text;
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  popupsEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
function updateHud(dt) {
  const txt = fmtTime(stats.time);
  if (txt !== timerText) { timerText = txt; timerEl.textContent = txt; }
  dashFillEl.style.width = `${Math.round((1 - clamp(dashCd / dashCooldown(), 0, 1)) * 100)}%`;
  chakraFillEl.style.width = `${Math.round(run.energy / ENERGY_MAX * 100)}%`;
  chakraFillEl.style.background = run.energy >= CLONE_COST ? '#ff9a2e' : '#8a5a2b';   // dim until there is enough for a cast
  buffHudT -= dt;
  if (buffHudT <= 0) {
    buffHudT = 0.25;
    if (buffs.triple > 0 || buffs.magnet > 0 || buffs.speed > 0 || buffs.clones > 0) renderBuffs();
  }
}

// --- best run, kept between visits -----------------------------------------
function loadBest() {
  try { return JSON.parse(localStorage.getItem('raccoon3d.best')) || null; } catch (e) { return null; }
}
function saveBest() {
  const stars = run.stars.reduce((a, b) => a + (b || 0), 0);
  const best = loadBest();
  if (best && best.score >= run.score) return false;
  try { localStorage.setItem('raccoon3d.best', JSON.stringify({ score: run.score, stars })); } catch (e) { /* private mode */ }
  return true;
}

// --- overlay screens --------------------------------------------------------
const starsHtml = (n) => '<div class="stars">' + [0, 1, 2].map(i => (i < n ? '★' : '<span class="off">★</span>')).join('') + '</div>';

const SHOP = [
  { id: 'heart', name: '+1 серце', desc: 'Більший запас життів', cost: 14, no: 'максимум', can: () => run.maxHearts < 5, buy: () => { run.maxHearts++; run.hearts++; } },
  { id: 'heal', name: 'Лікування', desc: 'Відновити одне життя', cost: 5, no: 'життя повні', can: () => run.hearts < run.maxHearts, buy: () => { run.hearts++; } },
  { id: 'discs', name: '+5 дисків', desc: 'Запас набоїв', cost: 4, no: '', can: () => true, buy: () => { run.ammo += 5; } },
  { id: 'fire', name: 'Швидкий постріл', desc: 'Диски летять частіше', cost: 9, no: 'вже куплено', can: () => !run.up.fire, buy: () => { run.up.fire = true; } },
  { id: 'jump', name: 'Пружні лапи', desc: 'Стрибок вищий на 12%', cost: 9, no: 'вже куплено', can: () => !run.up.jump, buy: () => { run.up.jump = true; } },
  { id: 'dash', name: 'Блискавичний ривок', desc: 'Ривок перезаряджається швидше', cost: 9, no: 'вже куплено', can: () => !run.up.dash, buy: () => { run.up.dash = true; } }
];

function showShop(res) {
  const def = LEVELS[levelIndex], next = LEVELS[levelIndex + 1];
  const items = SHOP.map((it) => {
    const ok = it.can();
    return `<button data-id="${it.id}" ${ok && run.gems >= it.cost ? '' : 'disabled'}>${it.name} <span class="cost">◆${it.cost}</span><small>${ok ? it.desc : it.no}</small></button>`;
  }).join('');
  overlay.innerHTML = `
    <h1>Рівень ${levelIndex + 1} пройдено!</h1>
    ${starsHtml(res.stars)}
    <div class="result">
      Час: ${fmtTime(stats.time)} (ціль ${fmtTime(def.par)}) · ${stats.damaged ? 'є ушкодження' : 'без ушкоджень'} · ${stats.secret ? 'секрет знайдено' : 'секрет не знайдено'}<br>
      Бонус: +${res.bonus} · Рахунок: ${run.score} · +1 життя
    </div>
    <div class="shopTitle">Крамниця · кристалів: ${run.gems}</div>
    <div class="shop">${items}</div>
    <button id="nextBtn" class="main">Далі: «${next.name}» →</button>`;
  overlay.classList.remove('hidden');
  toastEl.classList.add('hidden');
  hideHero();
  overlay.querySelectorAll('.shop button').forEach((btn) => btn.addEventListener('click', () => {
    const it = SHOP.find(s => s.id === btn.dataset.id);
    if (!it.can() || run.gems < it.cost) return;
    run.gems -= it.cost;
    it.buy();
    sfxBuy();
    renderHearts(); renderAmmo(); renderGems();
    showShop(res);
  }));
  $('nextBtn').addEventListener('click', () => {
    if (mode !== 'shop') return;
    overlay.classList.add('hidden');
    loadLevel(levelIndex + 1);
    mode = 'playing';
  });
}
function showEndScreen(title, text, button) {
  const stars = run.stars.reduce((a, b) => a + (b || 0), 0);
  const record = saveBest();
  const best = loadBest();
  overlay.innerHTML = `
    <h1>${title}</h1>
    <p>${text}</p>
    <div class="result">Рахунок: ${run.score} · Зірки: ${stars} / ${LEVELS.length * 3}${record ? ' · новий рекорд!' : best ? ` · рекорд: ${best.score}` : ''}</div>
    <button id="restartBtn" class="main">${button}</button>`;
  overlay.classList.remove('hidden');
  toastEl.classList.add('hidden');
  hideHero();
  bossBarEl.classList.add('hidden');
  $('restartBtn').addEventListener('click', () => location.reload());
}
function showWinScreen() {
  showEndScreen('Ти вдома!', `Єнот здолав Тіньового Володаря, пройшов усі ${LEVELS.length} рівнів і повернувся до затишної хатинки на вершині.`, 'Грати знову');
}
function showGameOverScreen() {
  showEndScreen('Гру закінчено', `Тіньові істоти здолали єнота на рівні ${levelIndex + 1} / ${LEVELS.length}.`, 'Спробувати знову');
}

// ===========================================================================
// Raccoon sprites: cut the nine poses out of the reference sheet, shrink them
// into pixel art (8 screen directions; right-facing ones are mirrored) and
// derive run/air frames by lifting the legs a couple of pixels.
// ===========================================================================
const SPR_W = 48, SPR_H = 40, SPR_TALL = 34;
const OUTLINE = [38, 27, 24];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cannot load ' + src));
    img.src = src;
  });
}

function addOutline(g, w, h, color) {
  const id = g.getImageData(0, 0, w, h), d = id.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] === 255;
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push(y * w + x);
  }
  for (const i of edge) {
    d[i * 4] = color[0]; d[i * 4 + 1] = color[1]; d[i * 4 + 2] = color[2]; d[i * 4 + 3] = 254;
  }
  for (const i of edge) d[i * 4 + 3] = 255;
  g.putImageData(id, 0, 0);
}

// frames: 0 standing, 1 left leg up, 2 right leg up, 3 both tucked (airborne)
function raccoonFrames(src, footX) {
  const LEG = 7, bottom = SPR_H - 2, top = bottom - LEG + 1;
  const make = (liftL, liftR) => {
    const out = new Uint8ClampedArray(SPR_W * SPR_H * 4);
    const copy = (x, y, ty) => {
      const s = (y * SPR_W + x) * 4;
      if (src[s + 3] !== 255 || ty < 0) return;
      const d = (ty * SPR_W + x) * 4;
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = 255;
    };
    for (let y = top; y <= bottom; y++) for (let x = 0; x < SPR_W; x++) copy(x, y, y - (x < footX ? liftL : liftR));
    for (let y = 0; y < top; y++) for (let x = 0; x < SPR_W; x++) copy(x, y, y);
    const c = makeCanvas(SPR_W, SPR_H);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.putImageData(new ImageData(out, SPR_W, SPR_H), 0, 0);
    addOutline(g, SPR_W, SPR_H, OUTLINE);
    return c;
  };
  return [make(0, 0), make(2, 0), make(0, 2), make(1, 1)];
}

async function extractRaccoon() {
  const img = await loadImage('assets/raccoon-sheet.webp');
  const S = 0.5;
  const W = Math.round(img.naturalWidth * S), H = Math.round(img.naturalHeight * S), N = W * H;
  const src = makeCanvas(W, H);
  const sg = src.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(img, 0, 0, W, H);
  const px = sg.getImageData(0, 0, W, H).data;

  // flood-fill the white backdrop (and soft grey floor shadows) in from the borders
  const bg = new Uint8Array(N), stack = new Int32Array(N);
  let sp = 0;
  const bgLike = (i) => {
    const o = i * 4, r = px[o], g = px[o + 1], b = px[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn > 150 && mx - mn < 16;
  };
  const seed = (i) => { if (!bg[i] && bgLike(i)) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i < N - W) seed(i + W);
  }

  // erode one pixel to drop the anti-aliased halo
  const fg = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!bg[i] && !bg[i - 1] && !bg[i + 1] && !bg[i - W] && !bg[i + W]) fg[i] = 1;
  }

  // connected components -> one blob per pose
  const label = new Int32Array(N);
  const blobs = [];
  for (let i0 = 0; i0 < N; i0++) {
    if (!fg[i0] || label[i0]) continue;
    const id = blobs.length + 1;
    const b = { id, minX: W, maxX: 0, minY: H, maxY: 0, area: 0 };
    sp = 0; stack[sp++] = i0; label[i0] = id;
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i - x) / W;
      b.area++;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      if (x > 0 && fg[i - 1] && !label[i - 1]) { label[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && fg[i + 1] && !label[i + 1]) { label[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && fg[i - W] && !label[i - W]) { label[i - W] = id; stack[sp++] = i - W; }
      if (y < H - 1 && fg[i + W] && !label[i + W]) { label[i + W] = id; stack[sp++] = i + W; }
    }
    blobs.push(b);
  }
  const poses = blobs.filter(b => b.area > N * 0.008).sort((a, b) => b.area - a.area).slice(0, 9);
  if (poses.length !== 9) throw new Error('expected 9 raccoon poses, found ' + poses.length);
  poses.sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
  const grid = [0, 1, 2].map(r => poses.slice(r * 3, r * 3 + 3).sort((a, b) => (a.minX + a.maxX) - (b.minX + b.maxX)));

  function makeSprite(b, mirror) {
    const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;
    let footSum = 0, footN = 0;
    for (let y = Math.floor(bh * 0.92); y < bh; y++) for (let x = 0; x < bw; x++) {
      if (label[(b.minY + y) * W + b.minX + x] === b.id) { footSum += x; footN++; }
    }
    const foot = footN ? footSum / footN : bw / 2;
    let sc = SPR_TALL / bh;
    if (bw * sc > SPR_W - 2) sc = (SPR_W - 2) / bw;
    const dw = Math.ceil(bw * sc), dh = Math.ceil(bh * sc);
    const ox = Math.max(1, Math.min(SPR_W - 1 - dw, Math.round(SPR_W / 2 - foot * sc)));
    const oy = SPR_H - 1 - dh;
    const od = new Uint8ClampedArray(SPR_W * SPR_H * 4);
    const q = (v) => Math.max(0, Math.min(255, Math.round(v / 20) * 20));
    for (let Y = 0; Y < dh; Y++) for (let X = 0; X < dw; X++) {
      const sx0 = Math.floor(X / sc), sx1 = Math.min(bw, Math.max(sx0 + 1, Math.floor((X + 1) / sc)));
      const sy0 = Math.floor(Y / sc), sy1 = Math.min(bh, Math.max(sy0 + 1, Math.floor((Y + 1) / sc)));
      let r = 0, g = 0, bl = 0, n = 0, tot = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        tot++;
        const si = (b.minY + sy) * W + b.minX + sx;
        if (label[si] === b.id) { r += px[si * 4]; g += px[si * 4 + 1]; bl += px[si * 4 + 2]; n++; }
      }
      if (!tot || n / tot < 0.5) continue;
      r /= n; g /= n; bl /= n;
      // a touch more saturation so the small sprite reads clearly
      const avg = (r + g + bl) / 3;
      r = avg + (r - avg) * 1.2; g = avg + (g - avg) * 1.2; bl = avg + (bl - avg) * 1.2;
      const tx = mirror ? SPR_W - 1 - (ox + X) : ox + X;
      const o = ((oy + Y) * SPR_W + tx) * 4;
      od[o] = q(r); od[o + 1] = q(g); od[o + 2] = q(bl); od[o + 3] = 255;
    }
    const footX = ox + foot * sc;
    return raccoonFrames(od, mirror ? SPR_W - 1 - footX : footX);
  }

  const front = grid[1][1], back = grid[1][0], sideL = grid[0][1], frontL = grid[2][2], backL = grid[0][2];
  // index = screen direction in 45° steps: 0 right, 1 up-right, 2 up, 3 up-left, 4 left, 5 down-left, 6 down, 7 down-right
  return [
    makeSprite(sideL, true), makeSprite(backL, true), makeSprite(back, false), makeSprite(backL, false),
    makeSprite(sideL, false), makeSprite(frontL, false), makeSprite(front, false), makeSprite(frontL, true)
  ];
}

// only used if the reference sheet cannot be loaded
function fallbackRaccoon() {
  const make = (mirror) => {
    const c = makeCanvas(SPR_W, SPR_H);
    const g = c.getContext('2d', { willReadFrequently: true });
    if (mirror) { g.translate(SPR_W, 0); g.scale(-1, 1); }
    const R = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    R('#8d7a68', 10, 22, 8, 5); R('#5c4a3c', 12, 22, 2, 5);      // tail
    R('#8a5a2b', 16, 18, 4, 9);                                  // backpack
    R('#9bc158', 19, 18, 11, 11);                                // jacket
    R('#e0568c', 21, 17, 7, 3);                                  // bandana
    R('#4a3c30', 20, 29, 3, 9); R('#4a3c30', 26, 29, 3, 9);      // legs
    R('#8d7a68', 16, 5, 16, 13);                                 // head
    R('#8d7a68', 16, 2, 4, 4); R('#8d7a68', 28, 2, 4, 4);        // ears
    R('#f1ead9', 19, 10, 10, 7);
    R('#3a332c', 18, 9, 5, 3); R('#3a332c', 25, 9, 5, 3);        // mask
    R('#2255aa', 20, 10, 2, 2); R('#2255aa', 26, 10, 2, 2);
    R('#2a1f18', 23, 13, 2, 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return raccoonFrames(g.getImageData(0, 0, SPR_W, SPR_H).data, SPR_W / 2);
  };
  const r = make(false), l = make(true);
  return [r, r, r, l, l, l, r, r];
}

// ---------------------------------------------------------------------------
// Ammo disc: the stone "play" disc from the reference icon, recoloured blue.
// The reference has a banner across its lower part, so only the clean upper
// half is read and mirrored down (the disc and its triangle are symmetric).
// ---------------------------------------------------------------------------
const DISC_PX = 18, SHOT_PX = 11, HUD_DISC_PX = 16;
const DISC_OUTLINE = [14, 32, 78];
const DISC_RAMP = [[22, 60, 130], [40, 105, 190], [70, 155, 235], [130, 200, 250], [205, 240, 255]];

// sample(u0, v0, u1, v1) -> { lum, cover } over a box of the disc's unit square
function renderDisc(n, sample) {
  const lum = new Float32Array(n * n).fill(-1);
  let lo = Infinity, hi = -Infinity;
  for (let Y = 0; Y < n; Y++) for (let X = 0; X < n; X++) {
    const s = sample(X / n, Y / n, (X + 1) / n, (Y + 1) / n);
    if (s.cover < 0.5) continue;
    lum[Y * n + X] = s.lum;
    lo = Math.min(lo, s.lum); hi = Math.max(hi, s.lum);
  }
  const size = n + 2;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true });
  const id = g.createImageData(size, size);
  const steps = DISC_RAMP.length - 1;
  for (let Y = 0; Y < n; Y++) for (let X = 0; X < n; X++) {
    const l = lum[Y * n + X];
    if (l < 0) continue;
    const col = DISC_RAMP[Math.round((hi > lo ? (l - lo) / (hi - lo) : 0.5) * steps)];
    const o = ((Y + 1) * size + X + 1) * 4;
    id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2]; id.data[o + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  addOutline(g, size, size, DISC_OUTLINE);
  return c;
}

async function extractDisc() {
  const img = await loadImage('assets/ammo-disc.png');
  const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const whiteLike = (i) => {
    const o = i * 4;
    if (px[o + 3] < 128) return true;
    const mx = Math.max(px[o], px[o + 1], px[o + 2]), mn = Math.min(px[o], px[o + 1], px[o + 2]);
    return mn > 236 && mx - mn < 14;
  };
  const stone = (i) => {
    const o = i * 4;
    return px[o + 3] >= 128 && Math.min(px[o], px[o + 1], px[o + 2]) < 200 &&
      !(px[o + 1] > px[o] + 30 && px[o + 1] > px[o + 2] + 30);   // not the green banner
  };

  // the circle is measured from the top and the sides, which the banner never touches
  let minX = W, maxX = 0, minY = H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!stone(y * W + x)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
  }
  const r = (maxX - minX + 1) / 2, cx = minX + r, cy = minY + r;
  if (!(r > 8)) throw new Error('disc not found in the icon');

  // background = everything outside the circle, plus white that connects to it or to the centre hole
  const bg = new Uint8Array(N), stack = new Int32Array(N);
  let sp = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) { bg[y * W + x] = 1; stack[sp++] = y * W + x; }
  }
  const seed = (i) => { if (!bg[i] && whiteLike(i)) { bg[i] = 1; stack[sp++] = i; } };
  seed(Math.floor(cy) * W + Math.floor(cx));
  while (sp) {
    const i = stack[--sp], x = i % W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i < N - W) seed(i + W);
  }

  const sample = (u0, v0, u1, v1) => {
    const x0 = Math.floor(minX + u0 * 2 * r), x1 = Math.max(x0 + 1, Math.floor(minX + u1 * 2 * r));
    const y0 = Math.floor(minY + v0 * 2 * r), y1 = Math.max(y0 + 1, Math.floor(minY + v1 * 2 * r));
    let sum = 0, n = 0, tot = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      tot++;
      const sy = y > cy ? Math.round(2 * cy - y) : y;   // lower half comes from the mirrored upper half
      if (x < 0 || x >= W || sy < 0 || sy >= H) continue;
      const i = sy * W + x;
      if (bg[i]) continue;
      sum += px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
      n++;
    }
    return { lum: n ? sum / n : 0, cover: tot ? n / tot : 0 };
  };
  return { world: renderDisc(DISC_PX, sample), shot: renderDisc(SHOT_PX, sample), hud: renderDisc(HUD_DISC_PX, sample) };
}

// only used if the icon cannot be loaded: a plain ring with a play-triangle hole
function fallbackDisc() {
  const sample = (u0, v0, u1, v1) => {
    const u = (u0 + u1) / 2 - 0.5, v = (v0 + v1) / 2 - 0.5;
    const inRing = u * u + v * v <= 0.25;
    const inHole = u > -0.14 && u < 0.2 && Math.abs(v) < (0.2 - u) * 0.55;
    return { lum: 0.5 - u - v, cover: inRing && !inHole ? 1 : 0 };
  };
  return { world: renderDisc(DISC_PX, sample), shot: renderDisc(SHOT_PX, sample), hud: renderDisc(HUD_DISC_PX, sample) };
}

function spriteTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const spriteMat = (c) => new THREE.SpriteMaterial({ map: spriteTexture(c), alphaTest: 0.5 });

let discMat = null, shotMat = null, chargeSprite = null;
const gemMat = spriteMat(gemCanvas);
const powerMat = {};
for (const k in powerCanvas) powerMat[k] = spriteMat(powerCanvas[k]);

let raccoonTex = [];   // [direction][frame]
const playerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ alphaTest: 0.5, fog: false }));
playerSprite.center.set(0.5, 1 / SPR_H);
playerSprite.scale.set(SPR_W / PPU, SPR_H / PPU, 1);
scene.add(playerSprite);
const playerBlob = makeBlob();
scene.add(playerBlob);

// dash afterimages
const ghosts = Array.from({ length: 6 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, color: 0x7fd0ff, fog: false }));
  s.center.copy(playerSprite.center);
  s.scale.copy(playerSprite.scale);
  s.visible = false;
  scene.add(s);
  return { s, life: 0 };
});
function spawnGhost() {
  const gh = ghosts.reduce((a, b) => (b.life < a.life ? b : a));
  gh.life = 0.25;
  gh.s.material.map = playerSprite.material.map;
  gh.s.material.needsUpdate = true;
  gh.s.position.copy(playerSprite.position);
  gh.s.visible = true;
}

// shield bubble
const shieldSprite = (() => {
  const n = 34, c = makeCanvas(n, n), g = c.getContext('2d');
  const id = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2);
    if (d > 14 && d < 16.2) {
      const o = (y * n + x) * 4;
      id.data[o] = 140; id.data[o + 1] = 220; id.data[o + 2] = 255; id.data[o + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTexture(c), alphaTest: 0.5, fog: false }));
  s.scale.set(n / PPU, n / PPU, 1);
  s.visible = false;
  scene.add(s);
  return s;
})();

// shadow clones: decoy copies of the raccoon that trail behind him and each take one hit for him
const clones = Array.from({ length: MAX_CLONES }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ alphaTest: 0.5, fog: false }));
  s.center.copy(playerSprite.center);
  s.visible = false;
  scene.add(s);
  const blob = makeBlob();
  blob.visible = false;
  scene.add(blob);
  return { s, blob, x: 0, y: 0, z: 0 };
});
function cloneSpot(i) {
  // behind the raccoon, one to each side
  const side = i === 0 ? -1 : 1;
  return [player.x - player.fx * 0.9 - player.fz * side * 0.9, player.y, player.z - player.fz * 0.9 + player.fx * side * 0.9];
}
function poof(x, y, z) {
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.6;
    addParticle(flat(0xf2f2f2), x, y + Math.random() * 0.6, z, Math.cos(a) * sp, 0.8 + Math.random() * 1.4, Math.sin(a) * sp, 0, 0.5 + Math.random() * 0.3, 2.2);
  }
}
function summonClones() {
  buffs.clones = MAX_CLONES;
  buffs.cloneT = CLONE_TIME;
  clones.forEach((c, i) => {
    [c.x, c.y, c.z] = cloneSpot(i);
    poof(c.x, c.y + 0.7, c.z);
  });
  sfxPoof();
}
// a clone steps in front of the blow and vanishes in smoke
function spendClone() {
  buffs.clones--;
  const c = clones[buffs.clones];
  poof(c.x, c.y + 0.7, c.z);
  popup('Пуф!', c.x, c.y + 2.2, c.z);
  sfxPoof();
  renderBuffs();
}

function facingSector() {
  const sx = player.fx * camRight.x + player.fz * camRight.z;
  const sy = player.fx * camFwdGround.x + player.fz * camFwdGround.z;
  return ((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8;
}

// ===========================================================================
// Level loading
// ===========================================================================
function islandAt(isles, x, z) {
  let best = null;
  for (const isl of isles) {
    if (isl.fixed && x >= isl.x && x <= isl.x + isl.w && z >= isl.z && z <= isl.z + isl.d && (!best || isl.y > best.y)) best = isl;
  }
  return best;
}

function spawnEnemy(d, group, isles) {
  const e = {
    type: d.type, alive: true, hp: 1, flash: 0, flashOn: false, state: 'idle', timer: 0,
    blob: null, dirX: 0, dirZ: 1, baseY: d.y, air: 0
  };
  if (d.type === 'walker' || d.type === 'flyer') {
    const flyer = d.type === 'flyer';
    Object.assign(e, {
      a: d.a, b: d.b, len: Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), u: 0, dir: 1, speed: d.speed, phase: d.phase || 0,
      x: d.a[0], z: d.a[1], half: flyer ? 0.4 : 0.48, h: flyer ? 0.6 : 0.95, score: flyer ? 150 : 100, gems: 1,
      model: flyer ? makeFlyer() : makeWalker()
    });
    if (flyer) { e.blob = makeBlob(); group.add(e.blob); }
  } else {
    const isl = islandAt(isles, d.at[0], d.at[1]);
    e.x = e.hx = d.at[0];
    e.z = e.hz = d.at[1];
    if (d.type === 'chaser') Object.assign(e, { hp: 2, half: 0.5, h: 1.0, score: 200, gems: 2, model: makeChaser() });
    else if (d.type === 'spitter') Object.assign(e, { hp: 2, half: 0.5, h: 1.3, score: 200, gems: 2, model: makeSpitter(), cool: 1.2 });
    else {
      const mini = !!d.mini;
      Object.assign(e, {
        mini, hp: mini ? 12 : 26, half: mini ? 0.85 : 1.2, h: mini ? 1.6 : 2.2, score: mini ? 1000 : 3000, gems: mini ? 6 : 12,
        model: makeBoss(mini), awake: false, seq: 0, drip: 0, arenaCol: isl.col
      });
    }
    const m = e.half + 0.15;
    e.area = { minX: isl.x + m, maxX: isl.x + isl.w - m, minZ: isl.z + m, maxZ: isl.z + isl.d - m };
  }
  e.maxHp = e.hp;
  e.minY = e.baseY;
  e.maxY = e.baseY + e.h;
  e.meshes = [];
  e.model.traverse((o) => { if (o.isMesh) e.meshes.push([o, o.material]); });
  group.add(e.model);
  return e;
}

function addPickup(kind, x, y, z, opt = {}) {
  let mat, w, h;
  if (kind === 'disc') { mat = discMat; w = h = DISC_PX + 2; }
  else if (kind === 'gem') {
    const k = (opt.value || 1) >= 5 ? 1.6 : 1;
    mat = gemMat; w = gemCanvas.width * k; h = gemCanvas.height * k;
  } else { mat = powerMat[opt.type]; w = powerCanvas[opt.type].width * 1.3; h = powerCanvas[opt.type].height * 1.3; }
  const m = new THREE.Sprite(mat);
  m.scale.set(w / PPU, h / PPU, 1);
  m.position.set(x, y, z);
  const blob = makeBlob();
  blob.scale.setScalar(0.7);
  blob.position.set(x, y - 0.82, z);
  blob.visible = !opt.auto;
  level.group.add(m, blob);
  const p = {
    kind, type: opt.type || null, value: opt.value || 1, x, y, z, m, blob, sw: w / PPU, taken: false,
    phase: level.pickups.length * 1.3, auto: !!opt.auto, delay: opt.delay || 0, pull: 0
  };
  level.pickups.push(p);
  return p;
}

function clearLevel() {
  if (level) {
    scene.remove(level.group);
    level.group.traverse((o) => { if (o.isMesh && o.geometry.type === 'BoxGeometry') o.geometry.dispose(); });
  }
  for (const s of shots) { scene.remove(s.m); s.m.material.dispose(); }
  for (const o of orbs) scene.remove(o.m);
  for (const w of waves) scene.remove(w.m);
  for (const pt of particles) scene.remove(pt.m);
  shots.length = orbs.length = waves.length = particles.length = 0;
}

function loadLevel(index) {
  clearLevel();
  levelIndex = index;
  lt = 0;
  const def = LEVELS[index];
  applyTheme(def.theme);
  const rnd = mulberry32(index * 9973 + 17);
  const group = new THREE.Group();
  const colliders = [];
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };

  const isles = def.islands.map((a) => {
    const o = a[5] || {};
    const isl = {
      x: a[0], z: a[1], w: a[2], d: a[3], y: a[4], move: o.move || null, crumble: !!o.crumble, gate: !!o.gate, bare: !!o.bare,
      off: 0, state: o.gate ? 'hidden' : 'idle', timer: 0, delay: 0, fallV: 0, group: new THREE.Group()
    };
    isl.fixed = !isl.move && !isl.crumble;
    buildIsland(isl.group, isl, rnd, isl.crumble ? 'crumble' : isl.move ? 'move' : 'grass');
    isl.col = { minX: isl.x, maxX: isl.x + isl.w, minZ: isl.z, maxZ: isl.z + isl.d, minY: isl.y - 2.5, maxY: isl.y, ground: true, off: isl.gate, isl };
    if (isl.gate) isl.group.visible = false;
    group.add(isl.group);
    colliders.push(isl.col);
    b.minX = Math.min(b.minX, isl.x); b.maxX = Math.max(b.maxX, isl.x + isl.w);
    b.minZ = Math.min(b.minZ, isl.z); b.maxZ = Math.max(b.maxZ, isl.z + isl.d);
    b.minY = Math.min(b.minY, isl.y); b.maxY = Math.max(b.maxY, isl.y);
    return isl;
  });

  // spots decoration must keep clear of
  const blocked = [{ x: def.spawn[0], z: def.spawn[1], r: 2 }, { x: def.goal[0], z: def.goal[1], r: 2.2 }];
  const block = (x, z, r) => blocked.push({ x, z, r });
  for (const a of def.discs) block(a[0], a[1], 1.2);
  for (const a of def.gems || []) block(a[0], a[1], 1);
  for (const a of def.powerups || []) block(a[1], a[2], 1.2);
  for (const a of def.pads || []) block(a[0], a[1], 1.5);
  for (const s of def.spikes || []) {
    for (let px = s[0]; px <= s[0] + s[2]; px += 0.7) for (let pz = s[1]; pz <= s[1] + s[3]; pz += 0.7) block(px, pz, 0.9);
  }
  for (const e of def.enemies) {
    if (e.a) for (let k = 0; k <= 8; k++) block(e.a[0] + (e.b[0] - e.a[0]) * k / 8, e.a[1] + (e.b[1] - e.a[1]) * k / 8, 1.5);
    else block(e.at[0], e.at[1], 2.5);
  }
  let chimney = null;
  if (def.cabin) {
    chimney = buildCabin(group, def.cabin[0], def.cabin[2], def.cabin[1], colliders);
    block(def.cabin[0], def.cabin[1], 3.6);
  }
  // the owl perches at a random free spot on one of the larger solid islands (never in a boss arena)
  const npcs = [];
  const perches = isles.filter(i => i.fixed && !i.gate && !i.bare && i.w >= 4 && i.d >= 4);
  for (const text of npcPlan[index]) {
    let placed = false;
    for (let tries = 0; tries < 200 && perches.length && !placed; tries++) {
      const isl = perches[(Math.random() * perches.length) | 0];
      const nx = isl.x + 1.1 + Math.random() * (isl.w - 2.2), nz = isl.z + 0.8 + Math.random() * (isl.d - 1.6);
      if (!blocked.every(o => (o.x - nx) ** 2 + (o.z - nz) ** 2 > (o.r * 0.6 + 0.6) ** 2)) continue;
      // not within earshot of the spawn point or of another owl
      if (Math.hypot(nx - def.spawn[0], nz - def.spawn[1]) < 5.5 || npcs.some(o => Math.hypot(nx - o.x, nz - o.z) < 9)) continue;
      const model = makeOwl();
      model.position.set(nx, isl.y, nz);
      isl.group.add(model);
      colliders.push({ minX: nx - 0.4, maxX: nx + 0.4, minZ: nz - 0.4, maxZ: nz + 0.4, minY: isl.y, maxY: isl.y + 1.9, ground: false, off: false });
      block(nx, nz, 2.5);
      npcs.push({ x: nx, y: isl.y, z: nz, text, model, near: false });
      placed = true;
    }
    // nowhere to perch here: the owl flies on and meets the raccoon on the next level instead
    if (!placed && index + 1 < LEVELS.length && !npcPlan[index + 1].includes(text)) npcPlan[index + 1].push(text);
  }
  // trees get an extra margin: their crowns would otherwise hide pickups and paths
  const treeFree = (x, z) => blocked.every(o => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + 1.2) ** 2);
  const propFree = (x, z) => blocked.every(o => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r * 0.5) ** 2);

  let lanterns = 0;
  for (const isl of isles) {
    if (isl.fixed && !isl.gate && !isl.bare && isl.w >= 5 && isl.d >= 5) {
      const want = Math.min(4, Math.floor(isl.w * isl.d / 24));
      for (let placed = 0, tries = 0; placed < want && tries < 60; tries++) {
        const x = isl.x + 0.9 + rnd() * (isl.w - 1.8);
        const z = isl.z + 0.7 + rnd() * Math.min(isl.d * 0.2, 1.6);   // back strip only, so trees never block or hide the path
        if (!treeFree(x, z)) continue;
        addTree(isl.group, x, isl.y, z, rnd, colliders);
        block(x, z, 1.2);
        placed++;
      }
      if (theme.lanterns && lanterns < 4 && propFree(isl.x + 0.7, isl.z + isl.d - 0.7)) {
        addLantern(isl.group, isl.x + 0.7, isl.y, isl.z + isl.d - 0.7);
        lanterns++;
      }
    }
    if (!isl.crumble) {
      const props = Math.floor(isl.w * isl.d / 5);
      for (let i = 0; i < props; i++) {
        const x = isl.x + 0.3 + rnd() * (isl.w - 0.6), z = isl.z + 0.3 + rnd() * (isl.d - 0.6);
        if (propFree(x, z)) addProp(isl.group, x, isl.y, z, rnd);
      }
    }
  }

  // unreachable scenery islands off to the north
  for (let i = 0; i < 7; i++) {
    const w = 3 + rnd() * 4, d = 3 + rnd() * 3;
    const isl = {
      x: b.minX - 10 + rnd() * (b.maxX - b.minX + 20), z: b.minZ - 13 - rnd() * 15,
      w, d, y: b.minY - 8 + rnd() * 9
    };
    buildIsland(group, isl, rnd, 'grass');
    addTree(group, isl.x + w * (0.3 + rnd() * 0.4), isl.y, isl.z + d * (0.3 + rnd() * 0.4), rnd, null);
    if (rnd() < 0.5) addProp(group, isl.x + 0.5 + rnd() * (w - 1), isl.y, isl.z + 0.5 + rnd() * (d - 1), rnd);
  }

  const flag = buildFlag(group, def.goal[0], def.goal[2], def.goal[1]);
  scene.add(group);

  level = {
    def, group, colliders, isles, chimney, flag, npcs, talking: null, bounds: b,
    pickups: [], enemies: [], boss: null, locked: false,
    spikes: (def.spikes || []).map(s => buildSpikes(group, s)),
    pads: (def.pads || []).map(p => buildPad(group, p)),
    winds: (def.wind || []).map(w => buildWind(group, w)),
    hints: (def.hints || []).map(h => ({ ...h, done: false })),
    secret: def.secret ? { x: def.secret[0], z: def.secret[1], y: def.secret[2], r: def.secret[3] } : null,
    spawn: { x: def.spawn[0], y: def.spawn[2], z: def.spawn[1] },
    goal: { x: def.goal[0], y: def.goal[2], z: def.goal[1] },
    fallY: b.minY - 14
  };

  for (const a of def.discs) addPickup('disc', a[0], a[2] + 0.85, a[1]);
  for (const a of def.gems || []) addPickup('gem', a[0], a[2] + 0.85, a[1], { value: a[3] || 1 });
  for (const a of def.powerups || []) addPickup('power', a[1], a[3] + 0.85, a[2], { type: a[0] });
  level.enemies = def.enemies.map(d => spawnEnemy(d, group, isles));
  level.boss = level.enemies.find(e => e.type === 'boss') || null;
  level.locked = !!level.boss;
  setFlagLocked(level.locked);

  // one static shadow frustum covering the whole level keeps shadow edges rock steady
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, cy = (b.minY + b.maxY) / 2;
  const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 14;
  sun.target.position.set(cx, cy, cz);
  sun.position.set(cx, cy, cz).addScaledVector(sunDir, 90);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
  sc.near = 1; sc.far = 220;
  sc.updateProjectionMatrix();

  placeClouds(b);
  const anchors = isles.filter(i => i.fixed && !i.gate);
  for (const f of fireflies) {
    const isl = anchors[(Math.random() * anchors.length) | 0];
    f.ax = isl.x + Math.random() * isl.w; f.ay = isl.y; f.az = isl.z + Math.random() * isl.d;
  }

  player.x = level.spawn.x; player.y = level.spawn.y; player.z = level.spawn.z;
  player.vx = player.vy = player.vz = 0;
  player.fx = 1; player.fz = 0;
  player.onGround = false; player.ground = null;
  checkpoint = { ...level.spawn };
  clones.forEach((c, i) => { [c.x, c.y, c.z] = cloneSpot(i); });   // surviving clones arrive with him
  airJumpsLeft = 0; airDashUsed = false;
  dashT = dashCd = dashGrace = stunT = 0;
  chargeT = 0; chargeReady = false;
  invulnTimer = 1.0;
  stats = { time: 0, damaged: false, secret: false };
  combo.count = 0; combo.timer = 0;
  camTarget.set(player.x + 2, player.y, player.z - 1);
  hideHero();
  heroTimer = index in heroPlan ? 2.5 + Math.random() * 7 : 0;   // a random moment early in the level

  levelIndicatorEl.textContent = `Рівень ${index + 1} / ${LEVELS.length} · ${def.name}`;
  renderHearts(); renderAmmo(); renderGems(); renderBuffs(); renderCombo(); renderBossBar();
  scoreEl.textContent = run.score;
  toast(`Рівень ${index + 1}: ${def.name}`, 2.2);
}

function setFlagLocked(locked) {
  const f = level.flag;
  f.mesh.material = flat(locked ? 0x6a6a72 : level.def.cabin ? 0xe8b23c : 0xd9453f);
  f.cloth.position.y = locked ? 1.1 : 2.8;
}

// highest walkable surface directly below a point, or null over the void
function groundBelow(x, z, y) {
  let best = null;
  for (const c of level.colliders) {
    if (!c.ground || c.off || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ || c.maxY > y + 0.05) continue;
    if (best === null || c.maxY > best) best = c.maxY;
  }
  return best;
}

// ===========================================================================
// Particles
// ===========================================================================
const particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
function addParticle(mat, x, y, z, vx, vy, vz, g, life, size) {
  const m = new THREE.Mesh(particleGeo, mat);
  m.position.set(x, y, z);
  m.scale.setScalar(size);
  scene.add(m);
  particles.push({ m, vx, vy, vz, g, life, size });
}
function burst(x, y, z, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    addParticle(glow(color), x, y, z, Math.cos(a) * speed * Math.random(), speed * (0.4 + Math.random() * 0.8),
      Math.sin(a) * speed * Math.random(), -18, 0.45 + Math.random() * 0.35, 1);
  }
}
function dust(x, y, z, count, color = 0xe8dcc8) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 1.6;
    addParticle(flat(color), x, y + 0.1, z, Math.cos(a) * sp, 0.6 + Math.random() * 1.2, Math.sin(a) * sp, -4, 0.3 + Math.random() * 0.2, 1.1);
  }
}
function puffSmoke(x, y, z) {
  addParticle(flat(0xdcdcdc), x, y, z, 0.25, 0.9, -0.1, 0, 1.8, 1.6);
}
function confetti(x, y, z) {
  for (const c of [0xffd23f, 0xe23b4a, 0x46a0f0, 0x7cb342, 0xffffff]) burst(x, y, z, c, 7, 6);
}

// ===========================================================================
// Player actions
// ===========================================================================
function loseHeart() {
  run.hearts--;
  renderHearts();
  if (run.hearts <= 0) {
    mode = 'gameover';
    sfxGameOver();
    showGameOverScreen();
  }
}

function markDamaged() {
  stats.damaged = true;
  combo.count = 0;
  combo.timer = 0;
  renderCombo();
}

// falling costs a heart, but puts the raccoon back on the last solid island he stood on
function resetPlayer() {
  player.x = checkpoint.x; player.y = checkpoint.y; player.z = checkpoint.z;
  player.vx = player.vy = player.vz = 0;
  player.ground = null;
  dashT = 0;
  invulnTimer = 1.2;
  markDamaged();
  shake(0.25, 0.25);
  sfxFall();
  loseHeart();
}

function damagePlayer(fromX, fromZ) {
  if (invulnTimer > 0 || isDashing() || mode !== 'playing') return false;
  if (buffs.clones > 0) {   // the decoy takes it: no heart lost, no knockback
    spendClone();
    invulnTimer = 0.8;
    shake(0.12, 0.15);
    return true;
  }
  const dx = player.x - fromX, dz = player.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  player.vx = dx / len * 6.5;
  player.vz = dz / len * 6.5;
  player.vy = 7;
  player.onGround = false;
  player.ground = null;
  dashT = 0;
  stunT = 0.22;   // brief loss of control so the knockback actually carries
  if (buffs.shield) {
    buffs.shield = false;
    invulnTimer = 1.0;
    burst(player.x, player.y + 0.9, player.z, 0x7fd0ff, 14, 5);
    popup('Щит зламано', player.x, player.y + 2.2, player.z);
    shake(0.2, 0.2);
    sfxShieldBreak();
    renderBuffs();
    return true;
  }
  invulnTimer = 1.2;
  hurtFlash = 0.2;
  markDamaged();
  shake(0.35, 0.3);
  hitStop(0.07);
  sfxHurt();
  loseHeart();
  return true;
}

// shots go where the raccoon faces, but lock onto an enemy that is roughly ahead
function aimDirection(from) {
  let best = null, bestScore = Infinity;
  for (const e of level.enemies) {
    if (!e.alive) continue;
    const dx = e.x - from.x, dz = e.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 13 || dist < 0.01) continue;
    const cos = (dx * player.fx + dz * player.fz) / dist;
    if (cos < 0.76) continue;   // ~40° cone
    const score = dist * (2 - cos);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (!best) return new THREE.Vector3(player.fx, 0, player.fz);
  return new THREE.Vector3(best.x - from.x, (best.minY + best.maxY) / 2 - from.y, best.z - from.z).normalize();
}

function fireShot(charged) {
  const from = new THREE.Vector3(player.x + player.fx * 0.4, player.y + 0.95, player.z + player.fz * 0.4);
  const base = aimDirection(from);
  const dirs = [base];
  if (!charged && buffs.triple > 0) for (const a of [-0.22, 0.22]) dirs.push(base.clone().applyAxisAngle(UP, a));
  for (const dir of dirs) {
    const m = new THREE.Sprite((charged ? discMat : shotMat).clone());   // own material: each shot spins on its own
    const px = charged ? (DISC_PX + 2) * 1.5 : SHOT_PX + 2;
    m.scale.set(px / PPU, px / PPU, 1);
    m.position.copy(from);
    scene.add(m);
    shots.push({ m, dir, speed: charged ? 21 : 17, life: charged ? 1.5 : 1.3, charged, dmg: charged ? 3 : 1, hit: new Set() });
  }
}
function tryShoot() {
  if (shootCooldown > 0) return;
  if (run.ammo <= 0) { sfxDeny(); shootCooldown = 0.25; return; }
  run.ammo--;
  renderAmmo();
  shootCooldown = run.up.fire ? 0.18 : 0.3;
  fireShot(false);
  sfxShoot();
}
function releaseCharged() {
  run.ammo -= CHARGE_EXTRA;
  renderAmmo();
  fireShot(true);
  player.vx -= player.fx * 4;   // recoil
  player.vz -= player.fz * 4;
  shake(0.15, 0.15);
  sfxChargedShot();
}

function playerHits(c) {
  return player.x + PR > c.minX && player.x - PR < c.maxX &&
    player.z + PR > c.minZ && player.z - PR < c.maxZ &&
    player.y < c.maxY - 0.001 && player.y + PH > c.minY + 0.001;
}

function groundJump() {
  player.vy = JUMP_V * (run.up.jump ? 1.12 : 1);
  player.onGround = false;
  player.ground = null;
  coyote = 0;
  jumpBuf = 0;
  airJumpsLeft = MAX_AIR_JUMPS;
  if (dashT > 0) {   // jumping out of a dash keeps most of its speed: a long jump
    dashT = 0;
    dashGrace = DASH_GRACE;
    player.vx = dashDX * DASH_SPEED * 0.7;
    player.vz = dashDZ * DASH_SPEED * 0.7;
  }
  squash = 0.25;
  dust(player.x, player.y, player.z, 4);
  sfxJump();
}
function airJump() {
  player.vy = DJUMP_V * (run.up.jump ? 1.12 : 1);
  airJumpsLeft--;
  squash = 0.2;
  burst(player.x, player.y, player.z, 0xffffff, 5, 2.5);
  sfxDoubleJump();
}

// ===========================================================================
// Update: islands, wind, player
// ===========================================================================
function updateIslands(dt) {
  for (const isl of level.isles) {
    const c = isl.col;
    if (isl.move) {
      const m = isl.move;
      const off = Math.sin((lt / m.period + (m.phase || 0)) * Math.PI * 2) * m.dist / 2;
      const d = off - isl.off;
      isl.off = off;
      const riding = player.ground === c;
      if (m.axis === 'y') {
        c.minY += d; c.maxY += d;
        isl.group.position.y = off;
        if (riding) player.y = c.maxY;
      } else if (m.axis === 'x') {
        c.minX += d; c.maxX += d;
        isl.group.position.x = off;
        if (riding) player.x += d;
        else if (playerHits(c)) player.x = d > 0 ? c.maxX + PR : c.minX - PR;
      } else {
        c.minZ += d; c.maxZ += d;
        isl.group.position.z = off;
        if (riding) player.z += d;
        else if (playerHits(c)) player.z = d > 0 ? c.maxZ + PR : c.minZ - PR;
      }
    } else if (isl.crumble) {
      if (isl.state === 'idle') {
        if (player.ground === c) { isl.state = 'shake'; isl.timer = 0.75; sfxCrumble(); }
      } else if (isl.state === 'shake') {
        isl.timer -= dt;
        isl.group.position.set((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1);
        if (isl.timer <= 0) {
          isl.state = 'fall'; isl.timer = 3.2; isl.fallV = 0;
          c.off = true;
          if (player.ground === c) { player.ground = null; player.onGround = false; }
          dust(isl.x + isl.w / 2, isl.y, isl.z + isl.d / 2, 10, 0xa9a091);
        }
      } else if (isl.state === 'fall') {
        isl.timer -= dt;
        if (isl.group.visible) {
          isl.fallV += 26 * dt;
          isl.group.position.y -= isl.fallV * dt;
          isl.group.visible = isl.group.position.y > -30;
        }
        if (isl.timer <= 0 && !playerHits(c)) {   // never reappear around the raccoon
          isl.state = 'idle';
          isl.group.position.set(0, 0, 0);
          isl.group.visible = true;
          c.off = false;
          dust(isl.x + isl.w / 2, isl.y, isl.z + isl.d / 2, 6, 0xa9a091);
        }
      }
    } else if (isl.state === 'rising') {
      if (isl.delay > 0) { isl.delay -= dt; continue; }
      isl.group.visible = true;
      isl.timer -= dt;
      isl.group.position.y = -14 * Math.max(0, isl.timer / 1.3) ** 2;
      if (isl.timer <= 0) {
        isl.state = 'open';
        isl.group.position.y = 0;
        c.off = false;
        dust(isl.x + isl.w / 2, isl.y, isl.z + isl.d / 2, 10);
        sfxLand();
      }
    }
  }
}

function openGates() {
  let k = 0;
  for (const isl of level.isles) {
    if (isl.gate && isl.state === 'hidden') {
      isl.state = 'rising'; isl.timer = 1.3; isl.delay = 0.6 + k++ * 0.45;
      isl.group.position.y = -14;
    }
  }
}

function updateWind(dt) {
  windX = windZ = 0;
  for (const w of level.winds) {
    const ph = (lt / w.period + w.phase) % 1;
    w.s = ph < w.duty ? clamp(Math.min(ph / 0.08, (w.duty - ph) / 0.08), 0, 1) : 0;
    for (const st of w.streaks) {
      st.visible = w.s > 0.05;
      if (!st.visible) continue;
      st.position.x += w.dx * w.push * 3 * dt;
      st.position.z += w.dz * w.push * 3 * dt;
      if (st.position.x > w.maxX) st.position.x = w.minX; else if (st.position.x < w.minX) st.position.x = w.maxX;
      if (st.position.z > w.maxZ) st.position.z = w.minZ; else if (st.position.z < w.minZ) st.position.z = w.maxZ;
    }
    if (w.s > 0 && player.x > w.minX && player.x < w.maxX && player.z > w.minZ && player.z < w.maxZ && player.y > w.minY && player.y < w.maxY) {
      windX += w.dx * w.push * w.s;
      windZ += w.dz * w.push * w.s;
    }
  }
}

function updatePlayer(dt) {
  if (shootCooldown > 0) shootCooldown -= dt;
  if (invulnTimer > 0) invulnTimer -= dt;
  if (dashCd > 0) dashCd -= dt;
  if (dashGrace > 0) dashGrace -= dt;
  if (hurtFlash > 0) hurtFlash -= dt;
  for (const k of ['triple', 'magnet', 'speed']) {
    if (buffs[k] > 0) { buffs[k] -= dt; if (buffs[k] <= 0) { buffs[k] = 0; renderBuffs(); } }
  }
  if (combo.timer > 0) { combo.timer -= dt; if (combo.timer <= 0) { combo.count = 0; renderCombo(); } }

  // --- chakra and the Shadow Clone Jutsu (Q) ---
  run.energy = Math.min(ENERGY_MAX, run.energy + ENERGY_REGEN * dt);
  if (buffs.clones > 0) {
    buffs.cloneT -= dt;
    if (buffs.cloneT <= 0) {   // unused clones fade on their own
      for (let i = 0; i < buffs.clones; i++) poof(clones[i].x, clones[i].y + 0.7, clones[i].z);
      buffs.clones = 0;
      sfxPoof();
      renderBuffs();
    }
  }
  const castDown = isDown('KeyQ');
  if (castDown && !castKeyPrev && stunT <= 0) {
    if (buffs.clones >= MAX_CLONES) {
      popup('Клони вже поруч', player.x, player.y + 2.4, player.z);
      sfxDeny();
    } else if (run.energy < CLONE_COST) {
      popup('Мало чакри', player.x, player.y + 2.4, player.z, 'bad');
      sfxDeny();
    } else {
      run.energy -= CLONE_COST;
      summonClones();
      popup(BUFF_NAME.clone, player.x, player.y + 2.4, player.z, 'gold');
      renderBuffs();
    }
  }
  castKeyPrev = castDown;

  // --- shooting: tap fires at once, holding charges a piercing shot released on key-up ---
  const fDown = isDown('KeyF');
  if (fDown && !fPrev) { tryShoot(); chargeT = 0; chargeReady = false; }
  if (fDown) {
    if (run.ammo >= CHARGE_EXTRA) {
      chargeT += dt;
      if (!chargeReady && chargeT >= CHARGE_TIME) { chargeReady = true; sfxChargeReady(); }
    } else { chargeT = 0; chargeReady = false; }
  } else {
    if (fPrev && chargeReady && run.ammo >= CHARGE_EXTRA) releaseCharged();
    chargeT = 0; chargeReady = false;
  }
  fPrev = fDown;

  // --- horizontal input: D/A along the level (x), W/S across it (z) ---
  let ix = (isDown('ArrowRight', 'KeyD') ? 1 : 0) - (isDown('ArrowLeft', 'KeyA') ? 1 : 0);
  let iz = (isDown('ArrowDown', 'KeyS') ? 1 : 0) - (isDown('ArrowUp', 'KeyW') ? 1 : 0);
  const maxSpeed = SPEED * (buffs.speed > 0 ? 1.35 : 1);
  const stunned = stunT > 0;
  if (stunned) { stunT -= dt; ix = iz = 0; }
  player.moving = ix !== 0 || iz !== 0;
  if (player.moving) {
    const len = Math.hypot(ix, iz);
    ix /= len; iz /= len;
    player.fx = ix; player.fz = iz;
  }

  // --- dash: a short burst with invulnerability; one per airtime ---
  const dashDown = isDown('ShiftLeft', 'ShiftRight', 'KeyE');   // E as well: tapping Shift five times opens Sticky Keys on Windows
  if (dashDown && !dashKeyPrev && !stunned && dashCd <= 0 && dashT <= 0 && (player.onGround || !airDashUsed)) {
    dashT = DASH_TIME;
    dashCd = dashCooldown();
    if (!player.onGround) airDashUsed = true;
    dashDX = player.fx; dashDZ = player.fz;
    ghostTimer = 0;
    squash = -0.2;
    dust(player.x, player.y, player.z, 5);
    sfxDash();
  }
  dashKeyPrev = dashDown;

  if (dashT > 0) {
    dashT -= dt;
    player.vx = dashDX * DASH_SPEED;
    player.vz = dashDZ * DASH_SPEED;
    player.vy = 0;
    ghostTimer -= dt;
    if (ghostTimer <= 0) { ghostTimer = 0.03; spawnGhost(); }
    if (dashT <= 0) {
      dashGrace = DASH_GRACE;
      player.vx = dashDX * maxSpeed;
      player.vz = dashDZ * maxSpeed;
    }
  } else if (!stunned) {
    // speed carried out of a dash-jump bleeds off slowly while airborne
    const fast = !player.onGround && Math.hypot(player.vx, player.vz) > maxSpeed + 0.5;
    if (player.moving) {
      player.vx = approach(player.vx, ix * maxSpeed, (fast ? 14 : ACCEL) * dt);
      player.vz = approach(player.vz, iz * maxSpeed, (fast ? 14 : ACCEL) * dt);
    } else {
      player.vx = approach(player.vx, 0, (fast ? 14 : FRICTION) * dt);
      player.vz = approach(player.vz, 0, (fast ? 14 : FRICTION) * dt);
    }
  }

  // --- jump: coyote time off ledges, buffered presses just before landing, one air jump ---
  if (player.onGround) coyote = COYOTE; else if (coyote > 0) coyote -= dt;
  if (jumpBuf > 0) jumpBuf -= dt;
  const jumpDown = isDown('Space');
  const jumpPressed = jumpDown && !jumpKeyPrev;
  jumpKeyPrev = jumpDown;
  const canGround = (player.onGround || coyote > 0) && !stunned;
  if (stunned) { /* no jumping while reeling */ } else if (jumpPressed) {
    if (canGround) groundJump();
    else if (airJumpsLeft > 0) airJump();
    else jumpBuf = JUMP_BUFFER;
  } else if (jumpBuf > 0 && canGround) groundJump();

  if (dashT <= 0) player.vy = Math.max(-MAX_FALL, player.vy - GRAVITY * dt);

  // --- move X, resolve collisions ---
  const mvx = player.vx + windX, mvz = player.vz + windZ;
  player.x += mvx * dt;
  for (const c of level.colliders) {
    if (c.off || !playerHits(c)) continue;
    if (c.ground && c.maxY - player.y <= STEP && player.vy <= 2) { player.y = c.maxY; continue; }
    if (mvx > 0) player.x = c.minX - PR;
    else if (mvx < 0) player.x = c.maxX + PR;
    player.vx = 0;
  }

  // --- move Z, resolve collisions ---
  player.z += mvz * dt;
  for (const c of level.colliders) {
    if (c.off || !playerHits(c)) continue;
    if (c.ground && c.maxY - player.y <= STEP && player.vy <= 2) { player.y = c.maxY; continue; }
    if (mvz > 0) player.z = c.minZ - PR;
    else if (mvz < 0) player.z = c.maxZ + PR;
    player.vz = 0;
  }

  // --- move Y, resolve collisions ---
  const prevY = player.y, wasGround = player.onGround, impact = -player.vy;
  player.onGround = false;
  player.ground = null;
  player.y += player.vy * dt;
  for (const c of level.colliders) {
    if (c.off || !playerHits(c)) continue;
    if (player.vy <= 0 && prevY >= c.maxY - 0.6) {
      player.y = c.maxY;
      player.vy = 0;
      player.onGround = true;
      player.ground = c;
      airJumpsLeft = MAX_AIR_JUMPS;
      airDashUsed = false;
      if (!wasGround && impact > 6) {
        squash = -0.22;
        dust(player.x, player.y, player.z, 5);
        if (impact > 9) sfxLand();
      }
      // remember the last safe footing on a solid island (never inside a spike bed)
      const isl = c.isl;
      if (isl && isl.fixed && isl.w >= 3 && isl.d >= 3) {
        const sx = clamp(player.x, c.minX + 0.8, c.maxX - 0.8), sz = clamp(player.z, c.minZ + 0.8, c.maxZ - 0.8);
        if (!level.spikes.some(s => sx > s.minX - 0.5 && sx < s.maxX + 0.5 && sz > s.minZ - 0.5 && sz < s.maxZ + 0.5)) {
          checkpoint.x = sx; checkpoint.y = c.maxY; checkpoint.z = sz;
        }
      }
    } else if (player.vy > 0 && prevY + PH <= c.minY + 0.05) {
      player.y = c.minY - PH;
      player.vy = 0;
    }
  }

  // --- fell off the islands ---
  if (player.y < level.fallY) resetPlayer();
}

function updateTraps(dt) {
  for (const s of level.spikes) {
    let target = 1, warn = false;
    if (s.period) {
      const ph = (lt / s.period + s.phase) % 1;
      target = ph < 0.5 ? 1 : 0;
      warn = ph > 0.86;   // the tips peek out just before they shoot up
    }
    s.up = approach(s.up, target, dt * 7);
    s.g.position.y = -0.44 * (1 - Math.max(s.up, warn ? 0.3 : 0));
    if (s.up > 0.6 && player.y <= s.y + 0.3 && player.y >= s.y - 0.1 &&
      player.x > s.minX + 0.1 && player.x < s.maxX - 0.1 && player.z > s.minZ + 0.1 && player.z < s.maxZ - 0.1) {
      damagePlayer(player.x + player.fx * 0.6, player.z + player.fz * 0.6);
    }
  }
  for (const p of level.pads) {
    if (p.squash > 0) p.squash = Math.max(0, p.squash - dt * 4);
    p.cap.scale.y = 1 - p.squash * 0.6;
    if (player.vy <= 0 && Math.abs(player.x - p.x) < 0.75 && Math.abs(player.z - p.z) < 0.75 &&
      player.y <= p.y + 0.6 && player.y >= p.y - 0.2) {
      player.vy = p.power;
      player.onGround = false;
      player.ground = null;
      airJumpsLeft = MAX_AIR_JUMPS;
      airDashUsed = false;
      coyote = 0;
      p.squash = 1;
      squash = 0.3;
      dust(p.x, p.y + 0.5, p.z, 6);
      sfxBounce();
    }
  }
}

// ===========================================================================
// Update: shots, orbs, shockwaves
// ===========================================================================
const orbGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
function spawnOrb(x, y, z, vx, vy, vz, life) {
  const m = new THREE.Mesh(orbGeo, glow(0xff4fd8));
  m.position.set(x, y, z);
  scene.add(m);
  orbs.push({ m, vx, vy, vz, life });
}
const waveGeo = new THREE.RingGeometry(0.93, 1, 32);
waveGeo.rotateX(-Math.PI / 2);
function spawnWave(x, y, z, max) {
  const m = new THREE.Mesh(waveGeo, waveMat);
  m.position.set(x, y + 0.12, z);
  scene.add(m);
  waves.push({ m, x, y, z, r: 0.6, max });
}

function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const pos = s.m.position;
    pos.addScaledVector(s.dir, s.speed * dt);
    s.m.material.rotation -= dt * 14;
    s.life -= dt;
    if (s.charged && Math.random() < 0.6) burst(pos.x, pos.y, pos.z, 0x9fe0ff, 1, 1.2);
    let dead = s.life <= 0;
    if (!dead) {
      for (const e of level.enemies) {
        if (!e.alive || s.hit.has(e)) continue;
        const cy = (e.minY + e.maxY) / 2;
        if (Math.hypot(pos.x - e.x, pos.z - e.z) < e.half + (s.charged ? 0.5 : 0.3) && Math.abs(pos.y - cy) < (e.maxY - e.minY) / 2 + 0.35) {
          s.hit.add(e);
          hitEnemy(e, s.dmg, pos.x, pos.y, pos.z);
          if (!s.charged) { dead = true; break; }
        }
      }
    }
    if (!dead) {
      for (let j = orbs.length - 1; j >= 0; j--) {
        const o = orbs[j];
        if (pos.distanceTo(o.m.position) < 0.6) {
          burst(pos.x, pos.y, pos.z, 0xff4fd8, 5, 3);
          scene.remove(o.m);
          orbs.splice(j, 1);
          addScore(10);
          if (!s.charged) { dead = true; break; }
        }
      }
    }
    if (!dead) {
      for (const c of level.colliders) {
        if (!c.off && pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ && pos.y > c.minY && pos.y < c.maxY) {
          burst(pos.x, pos.y, pos.z, 0x4fa8f0, 4, 2.5);
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      scene.remove(s.m);
      s.m.material.dispose();
      shots.splice(i, 1);
    }
  }
}

function updateOrbs(dt) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    const pos = o.m.position;
    pos.x += o.vx * dt; pos.y += o.vy * dt; pos.z += o.vz * dt;
    o.m.rotation.x += dt * 6; o.m.rotation.y += dt * 8;
    o.life -= dt;
    let dead = o.life <= 0;
    if (!dead && Math.abs(pos.x - player.x) < PR + 0.2 && Math.abs(pos.z - player.z) < PR + 0.2 &&
      pos.y > player.y - 0.2 && pos.y < player.y + PH) {
      dead = damagePlayer(pos.x - o.vx, pos.z - o.vz);
    }
    if (!dead) {
      for (const c of level.colliders) {
        if (!c.off && pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ && pos.y > c.minY && pos.y < c.maxY) { dead = true; break; }
      }
    }
    if (dead) {
      burst(pos.x, pos.y, pos.z, 0xff4fd8, 3, 2);
      scene.remove(o.m);
      orbs.splice(i, 1);
    }
  }
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    w.r += 9 * dt;
    w.m.scale.set(w.r, 1, w.r);
    // a shockwave only catches a raccoon standing on the ground: jump over it
    if (player.onGround && Math.abs(player.y - w.y) < 0.3 && Math.abs(Math.hypot(player.x - w.x, player.z - w.z) - w.r) < 0.45) {
      damagePlayer(w.x, w.z);
    }
    if (w.r > w.max) {
      scene.remove(w.m);
      waves.splice(i, 1);
    }
  }
}

// ===========================================================================
// Update: enemies
// ===========================================================================
function setFlash(e, on) {
  if (e.flashOn === on) return;
  e.flashOn = on;
  for (const [mesh, mat] of e.meshes) mesh.material = on ? flashMat : mat;
}

function hitEnemy(e, dmg, hx, hy, hz) {
  if (!e.alive) return;
  if (e.type === 'boss') {
    if (!e.awake) wakeBoss(e);
    if (e.state === 'charge') {   // armoured while it barrels forward: dodge, then punish the stun
      burst(hx, hy, hz, 0xfff0c0, 5, 4);
      beep(1800, 0.05, 'square', 0.04);
      return;
    }
    if (e.state === 'stun') dmg *= 2;
  }
  e.hp -= dmg;
  e.flash = 0.12;
  burst(hx, hy, hz, 0xffffff, 4, 3);
  if (e.hp <= 0) { killEnemy(e); return; }
  hitStop(0.03);
  sfxHitEnemy();
  if (e.type === 'boss') renderBossBar();
}

function killEnemy(e) {
  e.alive = false;
  e.model.visible = false;
  if (e.blob) e.blob.visible = false;
  const boss = e.type === 'boss';
  const cy = (e.minY + e.maxY) / 2;
  burst(e.x, cy, e.z, 0x9a6ad0, boss ? 40 : 14, boss ? 9 : 5);
  if (boss) confetti(e.x, cy + 1, e.z);

  run.energy = Math.min(ENERGY_MAX, run.energy + ENERGY_PER_KILL * (boss ? 5 : 1));   // fighting refills chakra
  combo.count = combo.timer > 0 ? combo.count + 1 : 1;
  combo.timer = 3.5;
  const mult = Math.min(5, combo.count);
  addScore(e.score * mult);
  popup(`+${e.score * mult}${mult > 1 ? ' x' + mult : ''}`, e.x, e.maxY + 0.6, e.z, mult > 1 || boss ? 'big' : 'gold');
  renderCombo();

  // loot flies to the raccoon after a beat, so nothing is lost over the void
  for (let i = 0; i < e.gems; i++) {
    addPickup('gem', e.x + (Math.random() - 0.5) * 1.4, cy + 0.3 + Math.random() * 0.8, e.z + (Math.random() - 0.5) * 1.4,
      { auto: true, delay: 0.45 + i * 0.05 });
  }
  if (boss) addPickup('power', e.x, cy + 1, e.z, { type: e.mini ? 'triple' : 'heart', auto: true, delay: 0.9 });
  else if (Math.random() < 0.24) {
    const pool = ['triple', 'magnet', 'speed', 'shield'];
    if (run.hearts < run.maxHearts) pool.push('heart', 'heart');
    addPickup('power', e.x, cy + 0.5, e.z, { type: pool[(Math.random() * pool.length) | 0], auto: true, delay: 0.6 });
  }

  shake(boss ? 0.6 : 0.18, boss ? 0.6 : 0.15);
  hitStop(boss ? 0.25 : 0.06);
  sfxKill();
  if (boss) bossDefeated(e);
}

function wakeBoss(e) {
  e.awake = true;
  e.state = 'idle';
  e.timer = 1.3;
  shake(0.3, 0.5);
  sfxRoar();
  toast(e.mini ? 'Міні-бос: Тіньовий Вартовий!' : 'БОС: Тіньовий Володар!', 2.5);
  renderBossBar();
}

function bossDefeated(e) {
  for (const o of orbs) scene.remove(o.m);
  for (const w of waves) scene.remove(w.m);
  orbs.length = waves.length = 0;
  level.locked = false;
  setFlagLocked(false);
  confetti(level.goal.x, level.goal.y + 2.5, level.goal.z);
  openGates();
  renderBossBar();
  sfxWin();
  toast(e.mini ? 'Вартового здолано! Прапор відкрито' : 'Володаря здолано! Міст додому піднімається', 3.5);
}

function bossRing(e, n, offset) {
  for (let k = 0; k < n; k++) {
    const a = offset + k * Math.PI * 2 / n;
    spawnOrb(e.x + Math.cos(a) * e.half, e.baseY + 0.65, e.z + Math.sin(a) * e.half, Math.cos(a) * 6, 0, Math.sin(a) * 6, 3.2);
  }
  sfxSpit();
}

function updateBoss(e, dt) {
  if (!e.awake) {
    if (player.ground === e.arenaCol) wakeBoss(e);
    return;
  }
  const A = e.area, mini = e.mini;
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  const p2 = e.hp <= e.maxHp / 2;

  // never leave the raccoon unarmed mid-fight: with no discs left, a few appear in the arena
  e.drip -= dt;
  if (run.ammo === 0 && e.drip <= 0 && !shots.length) {
    e.drip = 4;
    const inArena = (p) => p.x > A.minX && p.x < A.maxX && p.z > A.minZ && p.z < A.maxZ;
    if (!level.pickups.some(p => !p.taken && p.kind === 'disc' && inArena(p))) {
      for (let i = 0; i < 3; i++) {
        const px = A.minX + Math.random() * (A.maxX - A.minX), pz = A.minZ + Math.random() * (A.maxZ - A.minZ);
        addPickup('disc', px, e.baseY + 0.85, pz);
        burst(px, e.baseY + 0.85, pz, 0x9fe0ff, 6, 3);
      }
    }
  }
  const face = () => { e.dirX = dx / dist; e.dirZ = dz / dist; };
  const clampArea = () => {
    const cx = clamp(e.x, A.minX, A.maxX), cz = clamp(e.z, A.minZ, A.maxZ);
    const hit = cx !== e.x || cz !== e.z;
    e.x = cx; e.z = cz;
    return hit;
  };
  e.timer -= dt;
  switch (e.state) {
    case 'idle':
      face();
      if (dist > 1.5) {
        const sp = p2 ? 2.4 : 1.7;
        e.x += e.dirX * sp * dt; e.z += e.dirZ * sp * dt;
        clampArea();
      }
      if (e.timer <= 0) {
        const list = mini || !p2 ? ['charge', 'volley'] : ['charge', 'volley', 'slam'];
        const next = list[e.seq++ % list.length];
        e.state = next + 'Wind';
        e.timer = next === 'charge' ? 0.75 : 0.55;
        sfxWindup();
      }
      break;
    case 'chargeWind':
      face();
      if (e.timer <= 0) { e.state = 'charge'; e.timer = 1.3; }
      break;
    case 'charge': {
      const sp = (p2 ? 14 : 12) * (mini ? 0.85 : 1);
      e.x += e.dirX * sp * dt; e.z += e.dirZ * sp * dt;
      if (Math.random() < 0.5) dust(e.x, e.baseY, e.z, 1);
      if (clampArea()) {   // ran into the arena edge: stunned and open to double damage
        e.state = 'stun'; e.timer = mini ? 1.4 : 1.8;
        dust(e.x, e.baseY, e.z, 12);
        shake(0.4, 0.35);
        sfxSlam();
      } else if (e.timer <= 0) { e.state = 'idle'; e.timer = 0.7; }
      break;
    }
    case 'stun':
      if (Math.random() < 0.3) burst(e.x, e.maxY + 0.3, e.z, 0xffd23f, 1, 1.5);
      if (e.timer <= 0) { e.state = 'idle'; e.timer = 0.9; }
      break;
    case 'volleyWind':
      face();
      if (e.timer <= 0) {
        bossRing(e, mini ? 6 : p2 ? 12 : 8, 0);
        if (p2 && !mini) { e.state = 'volley2'; e.timer = 0.55; } else { e.state = 'idle'; e.timer = 1.3; }
      }
      break;
    case 'volley2':
      if (e.timer <= 0) { bossRing(e, 12, Math.PI / 12); e.state = 'idle'; e.timer = 1.3; }
      break;
    case 'slamWind':
      face();
      if (e.timer <= 0) {
        const T = 0.85;
        e.jvx = (clamp(player.x, A.minX, A.maxX) - e.x) / T;
        e.jvz = (clamp(player.z, A.minZ, A.maxZ) - e.z) / T;
        e.jvy = GRAVITY * T / 2;
        e.air = 0;
        e.state = 'slamAir'; e.timer = T;
      }
      break;
    case 'slamAir':
      e.x += e.jvx * dt; e.z += e.jvz * dt;
      e.jvy -= GRAVITY * dt;
      e.air = Math.max(0, e.air + e.jvy * dt);
      if (e.timer <= 0) {
        e.air = 0;
        spawnWave(e.x, e.baseY, e.z, 8.5);
        dust(e.x, e.baseY, e.z, 14);
        shake(0.5, 0.4);
        sfxSlam();
        e.state = 'idle'; e.timer = 1.2;
      }
      break;
  }
  e.minY = e.baseY + e.air;
  e.maxY = e.minY + e.h;
}

function updateChaser(e, dt) {
  const A = e.area;
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  e.timer -= dt;
  if (e.state === 'idle') {
    // amble back to its post until the raccoon steps onto its island
    const hx = e.hx - e.x, hz = e.hz - e.z, hd = Math.hypot(hx, hz);
    if (hd > 0.3) { e.dirX = hx / hd; e.dirZ = hz / hd; e.x += e.dirX * 1.2 * dt; e.z += e.dirZ * 1.2 * dt; }
    const inArea = player.x > A.minX - 0.5 && player.x < A.maxX + 0.5 && player.z > A.minZ - 0.5 && player.z < A.maxZ + 0.5;
    if (inArea && dist < 6.5 && Math.abs(player.y - e.baseY) < 1.8) { e.state = 'windup'; e.timer = 0.45; sfxWindup(); }
  } else if (e.state === 'windup') {
    e.dirX = dx / dist; e.dirZ = dz / dist;
    if (e.timer <= 0) { e.state = 'lunge'; e.timer = 0.55; }
  } else if (e.state === 'lunge') {
    e.x += e.dirX * 9.5 * dt; e.z += e.dirZ * 9.5 * dt;
    const cx = clamp(e.x, A.minX, A.maxX), cz = clamp(e.z, A.minZ, A.maxZ);
    const hit = cx !== e.x || cz !== e.z;
    e.x = cx; e.z = cz;
    if (Math.random() < 0.4) dust(e.x, e.baseY, e.z, 1);
    if (hit || e.timer <= 0) { e.state = 'rest'; e.timer = 0.9; }
  } else if (e.timer <= 0) e.state = 'idle';
}

function updateSpitter(e, dt) {
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  e.dirX = dx / dist; e.dirZ = dz / dist;
  if (e.state === 'idle') {
    e.cool -= dt;
    if (e.cool <= 0 && dist < 12 && Math.abs(player.y - e.baseY) < 5) { e.state = 'charge'; e.timer = 0.6; }
  } else {
    e.timer -= dt;
    if (e.timer <= 0) {
      const ox = e.x + e.dirX * 0.5, oy = e.baseY + 0.95, oz = e.z + e.dirZ * 0.5;
      const tx = player.x - ox, ty = player.y + 0.8 - oy, tz = player.z - oz, tl = Math.hypot(tx, ty, tz) || 1;
      spawnOrb(ox, oy, oz, tx / tl * 6.5, ty / tl * 6.5, tz / tl * 6.5, 3);
      sfxSpit();
      e.state = 'idle';
      e.cool = 2.3;
    }
  }
}

function poseEnemy(e, t) {
  const m = e.model;
  if (e.type === 'walker') {
    m.position.set(e.x, e.baseY + Math.abs(Math.sin(t * 9 + e.x)) * 0.08, e.z);
    m.userData.legs.forEach((leg, i) => { leg.position.y = 0.13 + Math.max(0, Math.sin(t * 12 + i * 1.6)) * 0.08; });
  } else if (e.type === 'flyer') {
    const cy = (e.minY + e.maxY) / 2;
    m.position.set(e.x, cy, e.z);
    const flap = Math.sin(t * 16) * 0.6;
    m.userData.wings[0].rotation.z = -flap;
    m.userData.wings[1].rotation.z = flap;
    const gy = groundBelow(e.x, e.z, cy);
    e.blob.visible = gy !== null;
    if (gy !== null) e.blob.position.set(e.x, gy + 0.03, e.z);
  } else if (e.type === 'chaser') {
    const wind = e.state === 'windup';
    m.position.set(e.x + (wind ? (Math.random() - 0.5) * 0.08 : 0), e.baseY, e.z);
    m.scale.y = wind ? 0.8 : 1;
    const rate = e.state === 'lunge' ? 26 : 10;
    m.userData.legs.forEach((leg, i) => { leg.position.y = 0.13 + Math.max(0, Math.sin(t * rate + i * 1.6)) * 0.1; });
  } else if (e.type === 'spitter') {
    m.position.set(e.x, e.baseY, e.z);
    const head = m.userData.head;
    head.rotation.y = Math.atan2(e.dirX, e.dirZ);
    head.scale.setScalar(e.state === 'charge' ? 1 + (1 - e.timer / 0.6) * 0.3 : 1);
    return;
  } else {
    const wind = e.state.endsWith('Wind');
    m.position.set(e.x + (wind ? (Math.random() - 0.5) * 0.12 : 0), e.minY, e.z);
    m.rotation.z = e.state === 'stun' ? Math.sin(t * 14) * 0.12 : 0;
    const rate = e.state === 'charge' ? 24 : e.awake ? 9 : 0;
    m.userData.legs.forEach((leg, i) => { leg.position.y = 0.15 + Math.max(0, Math.sin(t * rate + i * 1.6)) * 0.1; });
  }
  m.rotation.y = Math.atan2(e.dirX, e.dirZ);
}

function updateEnemies(dt, t, active) {
  for (const e of level.enemies) {
    if (!e.alive) continue;
    if (e.flash > 0) e.flash -= dt;
    setFlash(e, e.flash > 0);
    if (active) {
      if (e.type === 'walker' || e.type === 'flyer') {
        e.u += e.dir * e.speed * dt / e.len;
        if (e.u > 1) { e.u = 1; e.dir = -1; }
        if (e.u < 0) { e.u = 0; e.dir = 1; }
        e.x = e.a[0] + (e.b[0] - e.a[0]) * e.u;
        e.z = e.a[1] + (e.b[1] - e.a[1]) * e.u;
        e.dirX = (e.b[0] - e.a[0]) * e.dir;
        e.dirZ = (e.b[1] - e.a[1]) * e.dir;
        if (e.type === 'flyer') {
          e.phase += dt * 2.2;
          const cy = e.baseY + Math.sin(e.phase) * 0.5;
          e.minY = cy - 0.3; e.maxY = cy + 0.3;
        }
      } else if (e.type === 'chaser') updateChaser(e, dt);
      else if (e.type === 'spitter') updateSpitter(e, dt);
      else updateBoss(e, dt);

      if (e.alive && (e.type !== 'boss' || e.awake) &&
        Math.abs(player.x - e.x) < PR + e.half && Math.abs(player.z - e.z) < PR + e.half &&
        player.y < e.maxY && player.y + PH > e.minY) {
        damagePlayer(e.x, e.z);
      }
    }
    poseEnemy(e, t);
  }
}

// ===========================================================================
// Update: pickups, triggers, level end
// ===========================================================================
function applyPower(type) {
  let label = BUFF_NAME[type];
  if (type === 'shield') buffs.shield = true;
  else if (type === 'heart') {
    if (run.hearts < run.maxHearts) { run.hearts++; renderHearts(); } else { addScore(300); label = '+300'; }   // full health: points instead
  } else buffs[type] = BUFF_TIME[type];
  popup(label, player.x, player.y + 2.4, player.z, 'gold');
  burst(player.x, player.y + 1, player.z, 0xffffff, 10, 4);
  renderBuffs();
  sfxPower();
}

function collect(p) {
  p.taken = true;
  p.m.visible = false;
  p.blob.visible = false;
  if (p.kind === 'disc') {
    run.ammo++;
    renderAmmo();
    addScore(10);
    burst(p.x, p.y, p.z, 0x9fe0ff, 8, 3.5);
    sfxCollect();
  } else if (p.kind === 'gem') {
    run.gems += p.value;
    renderGems();
    addScore(25 * p.value);
    burst(p.x, p.y, p.z, 0xffd23f, p.value >= 5 ? 14 : 6, 3.5);
    if (p.value >= 5) popup(`+${p.value} кристалів`, p.x, p.y + 0.8, p.z, 'gold');
    sfxGem();
  } else applyPower(p.type);
}

function updatePickups(dt) {
  for (const p of level.pickups) {
    if (p.taken) continue;
    if (p.delay > 0) { p.delay -= dt; continue; }
    const cx = player.x - p.x, cy = player.y + 0.8 - p.y, cz = player.z - p.z;
    const d = Math.hypot(cx, cy, cz);
    if (p.auto || (buffs.magnet > 0 && p.kind !== 'power' && d < 6.5)) {
      p.pull += dt;
      const sp = Math.min(d, (9 + p.pull * 22) * dt);
      if (d > 0.01) { p.x += cx / d * sp; p.y += cy / d * sp; p.z += cz / d * sp; }
      p.blob.visible = false;
    }
    if (Math.hypot(cx, cz) < 0.85 && Math.abs(cy) < 1.3) collect(p);
  }
}

function updateTriggers(dt) {
  if (lockToast > 0) lockToast -= dt;
  const s = level.secret;
  if (s && !stats.secret && Math.hypot(player.x - s.x, player.z - s.z) < s.r && Math.abs(player.y - s.y) < 2) {
    stats.secret = true;
    addScore(500);
    confetti(player.x, player.y + 1.5, player.z);
    popup('+500', player.x, player.y + 2.4, player.z, 'big');
    toast('Секрет знайдено!', 2.5);
    sfxSecret();
  }
  for (const h of level.hints) {
    if (!h.done && Math.hypot(player.x - h.x, player.z - h.z) < h.r) { h.done = true; toast(h.text, 4.5); }
  }
  const g = level.goal;
  if (Math.hypot(player.x - g.x, player.z - g.z) < 0.9 && Math.abs(player.y - g.y) < 1.2) {
    if (!level.locked) finishLevel();
    else if (lockToast <= 0) { lockToast = 3; toast('Прапор запечатано — спершу здолай боса!', 2.5); }
  }
}

function finishLevel() {
  const def = LEVELS[levelIndex];
  const stars = 1 + (stats.time <= def.par ? 1 : 0) + (stats.damaged ? 0 : 1);
  const bonus = 500 + Math.max(0, Math.round((def.par * 1.6 - stats.time) * 10)) + (stats.damaged ? 0 : 500);
  addScore(bonus);
  run.stars[levelIndex] = stars;
  run.hearts = Math.min(run.maxHearts, run.hearts + 1);
  renderHearts();
  confetti(level.goal.x, level.goal.y + 2.5, level.goal.z);
  for (const k in keys) keys[k] = false;
  if (levelIndex === LEVELS.length - 1) {
    mode = 'won';
    sfxWin();
    showWinScreen();
  } else {
    mode = 'shop';
    sfxLevelUp();
    showShop({ stars, bonus });
  }
}

// ===========================================================================
// Update: ambient animation and visuals
// ===========================================================================
function updateAmbient(dt, t) {
  for (const c of clouds) {
    c.g.position.x += c.speed * dt;
    if (c.g.position.x > cloudBounds.maxX) c.g.position.x = cloudBounds.minX;
  }
  for (const p of level.pickups) {
    if (p.taken) continue;
    // coin-style spin: squash the width, never flip, so the disc's triangle always points right
    p.m.scale.x = p.sw * (p.kind === 'power' ? 1 + Math.sin(t * 5 + p.phase) * 0.08 : Math.max(0.2, Math.abs(Math.cos(t * 2.2 + p.phase))));
    p.m.position.set(p.x, p.y + Math.sin(t * 3 + p.phase) * 0.12, p.z);
    p.m.visible = p.delay <= 0;
  }
  level.flag.cloth.rotation.y = Math.sin(t * 3) * 0.3;
  if (!level.locked && level.flag.cloth.position.y < 2.8) level.flag.cloth.position.y = Math.min(2.8, level.flag.cloth.position.y + dt * 2);
  level.talking = null;
  for (const n of level.npcs) {
    const { bird, head, eyes, mark } = n.model.userData;
    const dx = player.x - n.x, dz = player.z - n.z;
    const near = mode === 'playing' && Math.hypot(dx, dz) < 4.2 && Math.abs(player.y - n.y) < 3;
    if (near && !n.near) sfxHoot();
    n.near = near;
    if (near && !level.talking) {
      level.talking = n;
      if (npcTextEl.textContent !== n.text) {
        npcNameEl.textContent = NPC_NAME;
        npcTextEl.textContent = n.text;
      }
    }
    // owls can: the head swivels to follow the raccoon all the way round
    let turn = Math.atan2(dx, dz) - head.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    head.rotation.y += turn * Math.min(1, dt * 6);
    bird.position.y = 0.45 + (near ? Math.abs(Math.sin(t * 6)) * 0.07 : 0);
    const blink = Math.sin(t * 1.3) > 0.985;
    for (const e of eyes) e.scale.y = blink ? 0.15 : 1;
    mark.visible = !near;
    mark.position.y = 2.45 + Math.sin(t * 4) * 0.1;
    mark.rotation.y = t * 2.5;
  }
  if (level.chimney) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) { smokeTimer = 0.4; puffSmoke(level.chimney.x, level.chimney.y, level.chimney.z); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.vy += pt.g * dt;
    pt.m.position.x += pt.vx * dt;
    pt.m.position.y += pt.vy * dt;
    pt.m.position.z += pt.vz * dt;
    pt.life -= dt;
    if (pt.life < 0.3) pt.m.scale.setScalar(Math.max(0.05, pt.life / 0.3) * pt.size);
    if (pt.life <= 0) {
      scene.remove(pt.m);
      particles.splice(i, 1);
    }
  }
  for (const gh of ghosts) {
    if (gh.life <= 0) continue;
    gh.life -= dt;
    gh.s.material.opacity = Math.max(0, gh.life / 0.25) * 0.55;
    if (gh.life <= 0) gh.s.visible = false;
  }
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) toastEl.classList.add('hidden');
  }

  // weather
  if (theme.rain) {
    for (const r of rain) {
      r.y -= r.sp * dt;
      if (r.y < -7) r.y = 15 + Math.random() * 3;
      r.m.position.set(camTarget.x + r.ox - r.y * 0.18, camTarget.y + r.y, camTarget.z + r.oz);
    }
  }
  if (theme.fireflies) {
    for (const f of fireflies) {
      f.m.position.set(f.ax + Math.sin(t * 0.7 + f.ph) * 1.2, f.ay + 1.3 + Math.sin(t * 1.1 + f.ph * 2) * 0.5, f.az + Math.cos(t * 0.6 + f.ph) * 1.2);
      f.m.visible = Math.sin(t * 2 + f.ph * 3) > -0.3;
    }
  }
  if (theme.lightning) {
    lightningT -= dt;
    if (lightningT <= 0) { lightningT = 4 + Math.random() * 5; lightningFlash = 0.3; sfxThunder(); }
    if (lightningFlash > 0) {
      lightningFlash -= dt;
      const k = lightningFlash > 0 ? Math.abs(Math.sin(lightningFlash * 30)) * (lightningFlash / 0.3) : 0;
      hemi.intensity = theme.hemiI * (1 + k * 1.8);
      flashEl.style.opacity = k * 0.22;
    }
  }
}

function syncVisuals(dt, t) {
  // camera: locked to the player horizontally (keeps the sprite pixel-steady), eased vertically
  camTarget.x = player.x + 2;
  camTarget.z = player.z - 1;
  camTarget.y += (player.y - camTarget.y) * (1 - Math.exp(-5 * dt));
  camera.position.copy(camTarget).add(camOffset);
  if (shakeT > 0) {
    shakeT -= dt;
    const amp = shakeAmp * Math.max(0, shakeT / shakeDur);
    camera.position.addScaledVector(camRight, (Math.random() * 2 - 1) * amp).addScaledVector(camUp, (Math.random() * 2 - 1) * amp);
  }
  snapToPixel(camera.position);

  // --- raccoon: pick the direction and the run/air frame ---
  const running = player.onGround && player.moving && dashT <= 0;
  let frame = 0;
  if (!player.onGround) frame = 3;
  else if (running) {
    runPhase += dt * 11 * (buffs.speed > 0 ? 1.3 : 1);
    const idx = Math.floor(runPhase) % 4;
    frame = [1, 0, 2, 0][idx];
    if (frame !== 0 && idx !== stepFrame) dust(player.x, player.y, player.z, 1);   // a puff at every footfall
    stepFrame = idx;
  }
  if (raccoonTex.length) {
    const tex = raccoonTex[facingSector()][frame];
    if (playerSprite.material.map !== tex) {
      playerSprite.material.map = tex;
      playerSprite.material.needsUpdate = true;
    }
  }
  // lean into the run, harder into a dash; stretch on take-off, squash on landing
  const screenVx = (player.vx * camRight.x + player.vz * camRight.z) / SPEED;
  const leanTarget = dashT > 0 ? -Math.sign(screenVx) * 0.35 : running ? -screenVx * 0.1 : !player.onGround ? -screenVx * 0.05 : 0;
  lean += (leanTarget - lean) * Math.min(1, dt * 14);
  squash += (0 - squash) * Math.min(1, dt * 10);
  playerSprite.material.rotation = lean;
  playerSprite.scale.set(SPR_W / PPU * (1 - squash * 0.6), SPR_H / PPU * (1 + squash), 1);
  playerSprite.material.color.copy(spriteTint);
  if (hurtFlash > 0) playerSprite.material.color.setRGB(spriteTint.r, spriteTint.g * 0.4, spriteTint.b * 0.4);
  // a small idle breath when standing still, so the raccoon never looks frozen
  const idle = player.onGround && !player.moving && !isDashing() && mode === 'playing';
  const idleBob = idle ? Math.sin(t * 2.1) * 0.022 : 0;
  // nudged toward the camera so nearby blocks behind the raccoon never clip his head
  tmpV.set(player.x, player.y + idleBob, player.z).addScaledVector(toCam, 0.8);
  playerSprite.position.copy(snapToPixel(tmpV));
  playerSprite.visible = !(invulnTimer > 0 && !isDashing() && mode === 'playing' && Math.floor(t * 16) % 2 === 0);

  // shadow clones copy the raccoon's pose and trail a step behind, one on each side
  clones.forEach((c, i) => {
    const on = i < buffs.clones;
    c.s.visible = on;
    c.blob.visible = false;
    if (!on) return;
    const [tx, ty, tz] = cloneSpot(i);
    const k = Math.min(1, dt * 9);
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * Math.min(1, dt * 12); c.z += (tz - c.z) * k;
    if (c.s.material.map !== playerSprite.material.map) {
      c.s.material.map = playerSprite.material.map;
      c.s.material.needsUpdate = true;
    }
    c.s.material.color.setRGB(spriteTint.r * 0.8, spriteTint.g * 0.88, spriteTint.b);   // a cool tint tells them from the real one
    c.s.material.rotation = lean;
    c.s.scale.set(SPR_W / PPU * 0.92, SPR_H / PPU * 0.92, 1);
    tmpV.set(c.x, c.y, c.z).addScaledVector(toCam, 0.6);
    c.s.position.copy(snapToPixel(tmpV));
    const cg = groundBelow(c.x, c.z, c.y);
    c.blob.visible = cg !== null;
    if (cg !== null) { c.blob.position.set(c.x, cg + 0.03, c.z); c.blob.scale.setScalar(0.75); }
  });

  shieldSprite.visible = buffs.shield;
  if (buffs.shield) {
    shieldSprite.position.set(player.x, player.y + 1.05, player.z).addScaledVector(toCam, 1);
    shieldSprite.material.rotation = t * 1.5;
  }
  if (chargeSprite) {
    const k = clamp(chargeT / CHARGE_TIME, 0, 1);
    chargeSprite.visible = chargeT > 0.15 && mode === 'playing';
    if (chargeSprite.visible) {
      const s = (DISC_PX + 2) / PPU * (0.35 + k * 0.9) * (chargeReady ? 1 + Math.sin(t * 30) * 0.12 : 1);
      chargeSprite.scale.set(s, s, 1);
      chargeSprite.material.rotation = -t * (4 + k * 14);
      chargeSprite.position.set(player.x + player.fx * 0.7, player.y + 1.0, player.z + player.fz * 0.7).addScaledVector(toCam, 1.2);
    }
  }

  const gy = groundBelow(player.x, player.z, player.y);
  playerBlob.visible = gy !== null;
  if (gy !== null) {
    playerBlob.position.set(player.x, gy + 0.03, player.z);
    playerBlob.scale.setScalar(Math.max(0.45, 0.9 - (player.y - gy) * 0.1));
  }

  // the character's plate is pinned just above its head on screen
  const npc = level.talking;
  const showPlate = !!npc && mode === 'playing';
  npcPlateEl.classList.toggle('hidden', !showPlate);
  if (showPlate) {
    camera.updateMatrixWorld();
    const [sx, sy] = screenPos(npc.x, npc.y + 2.5, npc.z);
    npcPlateEl.style.left = Math.round(sx) + 'px';
    npcPlateEl.style.top = Math.round(sy) + 'px';
  }
}

function update(rdt, t) {
  updateMusic(rdt);
  let dt = rdt;
  if (freezeT > 0) { freezeT -= rdt; dt = 0; }   // hit-stop: the world holds still for a few frames
  if (dt > 0) {
    updateAmbient(dt, t);
    updateHero(dt);
    if (mode === 'playing') {
      lt += dt;
      stats.time += dt;
      updateIslands(dt);
      updateWind(dt);
      updatePlayer(dt);
      if (mode === 'playing') {
        updateTraps(dt);
        updateShots(dt);
        updateOrbs(dt);
        updateEnemies(dt, t, true);
        updatePickups(dt);
      }
      if (mode === 'playing') updateTriggers(dt);
      updateHud(dt);
    } else {
      updateEnemies(dt, t, false);
    }
  }
  syncVisuals(rdt, t);
}

// ===========================================================================
// Boot
// ===========================================================================
let last = 0;
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt, now / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

async function boot() {
  let sprites;
  try {
    sprites = await extractRaccoon();
  } catch (err) {
    console.warn('Raccoon sheet unavailable, using the fallback sprite:', err);
    sprites = fallbackRaccoon();
  }
  raccoonTex = sprites.map(frames => frames.map(spriteTexture));
  const title = $('titleSprite');
  if (title) title.getContext('2d').drawImage(sprites[6][0], 0, 0);
  $('heroPortrait').getContext('2d').drawImage(sprites[7][0], 0, 0);   // three-quarter view, turned toward his plate

  let disc;
  try {
    disc = await extractDisc();
  } catch (err) {
    console.warn('Ammo icon unavailable, using the fallback disc:', err);
    disc = fallbackDisc();
  }
  discMat = spriteMat(disc.world);
  shotMat = spriteMat(disc.shot);
  chargeSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discMat.map, alphaTest: 0.5, fog: false }));
  chargeSprite.visible = false;
  scene.add(chargeSprite);
  $('ammoIcon').innerHTML = imgTag(disc.hud, 2);

  const best = loadBest();
  if (best) $('bestLine').textContent = `Рекорд: ${best.score} очок · ${best.stars} / ${LEVELS.length * 3} зірок`;

  loadLevel(0);
  toastEl.classList.add('hidden');
  toastT = 0;
  mode = 'menu';

  startBtn.disabled = false;
  startBtn.textContent = 'Почати гру';
  startBtn.addEventListener('click', () => {
    ensureAudio();
    overlay.classList.add('hidden');
    mode = 'playing';
  });

  window.__gameReady = true;
  // small inspection handle for testing from the console
  window.__game = {
    player, sprites, disc, run, buffs, npcPlan, heroPlan,
    get heroTimer() { return heroTimer; },
    get mode() { return mode; },
    get hearts() { return run.hearts; },
    get ammo() { return run.ammo; },
    get stats() { return stats; },
    get levelIndex() { return levelIndex; },
    get level() { return level; },
    get checkpoint() { return checkpoint; },
    get orbs() { return orbs; },
    get shots() { return shots; },
    loadLevel(i) { overlay.classList.add('hidden'); loadLevel(i); mode = 'playing'; },
    step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) update(dt, performance.now() / 1000); }
  };

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
}

boot();
