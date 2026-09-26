import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { SCENARIOS, buildScenario, ROLE_INFO, OUR_ROLES, OPP_COLOR, TARGET, lineup } from './volleyball.js';

const $ = s => document.querySelector(s);
const isMobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const BODY_Y = 1.05;
const BALL_R = 0.17;

const state = {
  sz: 1, scenarioId: 'sr-oh', t: 0, playing: true, speed: isMobile ? 0.6 : 0.5,
  highlight: new Set(), random: false, seed: 1, autoPause: false, stopAt: null,
  show: { opp: true, paths: true, labels: true, zones: true },
};
let built = null;

// ---------------------------------------------------------------- renderer
const container = $('#scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('#loading').innerHTML = '<p>Your browser could not start WebGL. Try a recent Chrome, Edge, Firefox or Safari.</p>';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.75 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x060a14, 45, 110);
const camera = new THREE.PerspectiveCamera(isMobile ? 55 : 45, innerWidth / innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 5;
controls.maxDistance = 70;

const VIEWS = {
  behind:   { label: 'Behind', pos: [0, 12.5, 19], target: [0, 0, 1.8] },
  top:      { label: 'Top', pos: [0, 30, 0.01], target: [0, 0, 0] },
  side:     { label: 'Side', pos: [19, 8.5, 2.5], target: [0, 0, 1.5] },
  coach:    { label: 'Coach', pos: [-13, 12, 15], target: [0, 0, 2] },
  opponent: { label: 'Opponent', pos: [0, 9, -19], target: [0, 0, 2.5] },
};
// Phones in portrait need the camera further back to fit the court width.
const viewPos = v => {
  const p = new THREE.Vector3(...v.pos), t = new THREE.Vector3(...v.target);
  const aspect = innerWidth / innerHeight;
  if (aspect < 1) p.sub(t).multiplyScalar(Math.min(1.7, 1 / aspect ** 0.6)).add(t);
  return p;
};
camera.position.copy(viewPos(VIEWS.behind));
controls.target.set(...VIEWS.behind.target);

// ---------------------------------------------------------------- helpers
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const glowTex = canvasTex(128, 128, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});

// ---------------------------------------------------------------- environment
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x13244a) }, bottom: { value: new THREE.Color(0x02040a) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.7, h)), 1.); }',
    }),
  );
  scene.add(sky);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x0a0f1d, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(140, 70, 0x1c2c52, 0x131e38);
  grid.position.y = 0.001;
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);

  // Stands with a crowd
  const standMat = new THREE.MeshStandardMaterial({ color: 0x111a2e, roughness: 0.9 });
  const crowdPts = [];
  const tiers = 7;
  const addStand = (cx, cz, len, alongX, facing) => {
    for (let i = 0; i < tiers; i++) {
      const h = 0.45 * (i + 1), off = 1.0 * i;
      const geo = alongX ? new THREE.BoxGeometry(len, h, 1.0) : new THREE.BoxGeometry(1.0, h, len);
      const m = new THREE.Mesh(geo, standMat);
      const px = alongX ? cx : cx + facing * off, pz = alongX ? cz + facing * off : cz;
      m.position.set(px, h / 2, pz);
      m.receiveShadow = true;
      scene.add(m);
      const n = Math.floor(len / (isMobile ? 1.1 : 0.75));
      for (let k = 0; k < n; k++) {
        if (Math.random() < 0.18) continue;
        const u = (k / n - 0.5) * len + (Math.random() - 0.5) * 0.3;
        crowdPts.push(alongX ? [cx + u, h + 0.35, pz] : [px, h + 0.35, cz + u]);
      }
    }
  };
  addStand(-10.5, 0, 30, false, -1);
  addStand(10.5, 0, 30, false, 1);
  addStand(0, -19, 20, true, -1);
  addStand(0, 19, 20, true, 1);
  const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.7 }), crowdPts.length);
  const palette = [0x2b3a67, 0x3c4f8a, 0x7b2d3a, 0x9a8c6a, 0x5c6b7a, 0x26314f, 0x8a3a52, 0xc9c9d6];
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  crowdPts.forEach((p, i) => {
    mtx.makeTranslation(p[0], p[1], p[2]);
    crowd.setMatrixAt(i, mtx);
    crowd.setColorAt(i, col.setHex(palette[Math.floor(Math.random() * palette.length)]));
  });
  scene.add(crowd);

  // Arena lights: glowing rigs + real lights
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x10131c, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-6, 22, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 16, bottom: -16, near: 1, far: 60 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rimBlue = new THREE.PointLight(0x4f7cff, 60, 45);
  rimBlue.position.set(0, 10, -16);
  scene.add(rimBlue);
  const rimWarm = new THREE.PointLight(0xffb070, 40, 45);
  rimWarm.position.set(0, 10, 16);
  scene.add(rimWarm);
  for (const [x, z] of [[-11, -14], [11, -14], [-11, 14], [11, 14]]) {
    const rig = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 0.3), new THREE.MeshBasicMaterial({ color: 0xeaf2ff }));
    rig.position.set(x, 17, z);
    rig.lookAt(0, 0, 0);
    scene.add(rig);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcfe0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8, fog: false }));
    glow.scale.set(9, 9, 1);
    glow.position.copy(rig.position);
    scene.add(glow);
  }
}

// ---------------------------------------------------------------- court
const PX = 110; // canvas pixels per metre
{
  const free = new THREE.Mesh(new THREE.PlaneGeometry(15, 30), new THREE.MeshStandardMaterial({ color: 0x1d5aa6, roughness: 0.55 }));
  free.rotation.x = -Math.PI / 2;
  free.position.y = 0.004;
  free.receiveShadow = true;
  scene.add(free);

  const courtTex = canvasTex(9 * PX, 18 * PX, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#e2833f'); gr.addColorStop(0.5, '#d9722f'); gr.addColorStop(1, '#e2833f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.05; // subtle floor boards
    for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? '#000' : '#fff'; g.fillRect(x, 0, 8, h); }
    g.globalAlpha = 1;
    g.fillStyle = '#fff';
    const lw = 0.05 * PX;
    g.fillRect(0, 0, lw, h); g.fillRect(w - lw, 0, lw, h);
    g.fillRect(0, 0, w, lw); g.fillRect(0, h - lw, w, lw);
    g.fillRect(0, h / 2 - lw / 2, w, lw);
    g.fillRect(0, h / 2 - 3 * PX - lw / 2, w, lw);
    g.fillRect(0, h / 2 + 3 * PX - lw / 2, w, lw);
  });
  const court = new THREE.Mesh(new THREE.PlaneGeometry(9, 18), new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.45, metalness: 0.05 }));
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.008;
  court.receiveShadow = true;
  scene.add(court);
}

// Zone numbers + setter target on our half (toggleable)
const zoneLayer = (() => {
  const tex = canvasTex(9 * PX, 9 * PX, (g, w) => {
    const toC = (x, z) => [(x + 4.5) * PX, z * PX];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${1.5 * PX}px Inter, system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (const [n, x, z] of [[4, -3, 1.5], [3, 0, 1.5], [2, 3, 1.5], [5, -3, 6], [6, 0, 6], [1, 3, 6]]) g.fillText(n, ...toC(x, z));
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 3; g.setLineDash([14, 12]);
    for (const x of [-1.5, 1.5]) { g.beginPath(); g.moveTo(...toC(x, 0)); g.lineTo(...toC(x, 9)); g.stroke(); }
    g.setLineDash([]);
    const [tx, tz] = toC(TARGET[0], TARGET[1] + 0.2);
    g.strokeStyle = 'rgba(250,204,21,0.7)'; g.lineWidth = 5;
    g.beginPath(); g.arc(tx, tz, 0.45 * PX, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(250,204,21,0.8)';
    g.font = `700 ${0.28 * PX}px Inter, system-ui, sans-serif`;
    g.fillText('TARGET', tx, tz + 0.75 * PX);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.012, 4.5);
  scene.add(m);
  return m;
})();

// Net
{
  const netTex = canvasTex(64, 64, g => {
    g.strokeStyle = 'rgba(20,20,24,0.9)'; g.lineWidth = 6;
    g.strokeRect(0, 0, 64, 64);
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(48, 5);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 1.0), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, 1.93, 0);
  net.rotation.y = 0;
  scene.add(net);
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
  const tape = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.07, 0.02), white);
  tape.position.set(0, 2.395, 0); tape.castShadow = true;
  scene.add(tape);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.04, 0.015), white);
  bottom.position.set(0, 1.45, 0);
  scene.add(bottom);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 0.7, roughness: 0.3 });
  for (const x of [-5.1, 5.1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.6, 16), postMat);
    post.position.set(x, 1.3, 0); post.castShadow = true;
    scene.add(post);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.8, 16), new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.6 }));
    pad.position.set(x, 0.9, 0);
    scene.add(pad);
  }
  const antTex = canvasTex(8, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e11d48'; g.fillRect(0, (i * h) / 8, w, h / 8); }
  });
  for (const x of [-4.5, 4.5]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.8, 8), new THREE.MeshBasicMaterial({ map: antTex }));
    a.position.set(x, 2.33, 0);
    scene.add(a);
  }
}

// ---------------------------------------------------------------- players
const SPHERE_GEO = new THREE.SphereGeometry(0.3, 32, 16);
const RING_GEO = new THREE.RingGeometry(0.34, 0.46, 40);
const PULSE_GEO = new THREE.RingGeometry(0.5, 0.58, 48);
const STEM_GEO = new THREE.CylinderGeometry(0.025, 0.025, 1, 8).translate(0, 0.5, 0);
const players = [];

function makePlayer(id, role, isOpp) {
  const color = isOpp ? OPP_COLOR : ROLE_INFO[role].color;
  const c = new THREE.Color(color);
  const g = new THREE.Group();
  const sphereMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.15, transparent: true });
  const sphere = new THREE.Mesh(SPHERE_GEO, sphereMat);
  sphere.castShadow = true;
  sphere.userData.role = role; sphere.userData.isOpp = isOpp;
  const ringMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(RING_GEO, ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  const stemMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45 });
  const stem = new THREE.Mesh(STEM_GEO, stemMat);
  const pulseMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const pulse = new THREE.Mesh(PULSE_GEO, pulseMat);
  pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.025;
  const div = document.createElement('div');
  div.className = 'plabel' + (isOpp ? ' opp' : '');
  div.style.setProperty('--c', color);
  const short = isOpp ? role.replace(/\d/, '') : role;
  div.innerHTML = `<span class="short">${short}</span><span class="full">${isOpp ? '' : ' · ' + ROLE_INFO[role].name}</span>`;
  const lab = new CSS2DObject(div);
  g.add(sphere, ring, stem, pulse, lab);
  scene.add(g);
  const P = { id, role, isOpp, g, sphere, ring, stem, pulse, lab, div, mats: [sphereMat, ringMat, stemMat] };
  players.push(P);
  return P;
}
for (const r of OUR_ROLES) makePlayer(r, r, false);
for (const r of OUR_ROLES) makePlayer('o' + r, r, true);

// ---------------------------------------------------------------- ball
const ballTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#ffd43b'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d4ed8';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(i * w / 3, 0);
    g.bezierCurveTo(i * w / 3 + 40, h * 0.35, i * w / 3 - 10, h * 0.65, i * w / 3 + 30, h);
    g.lineTo(i * w / 3 + 55, h);
    g.bezierCurveTo(i * w / 3 + 15, h * 0.65, i * w / 3 + 65, h * 0.35, i * w / 3 + 25, 0);
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
  for (let y = 0; y < h; y += h / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
});
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 16), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.4, emissive: 0x332200, emissiveIntensity: 0.4 }));
ball.castShadow = true;
scene.add(ball);
const ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe066, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
ballGlow.scale.set(1.1, 1.1, 1);
scene.add(ballGlow);
const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
ballShadow.rotation.x = -Math.PI / 2;
scene.add(ballShadow);
const TRAIL_N = 26;
const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.35, depthWrite: false }), TRAIL_N);
trail.frustumCulled = false;
scene.add(trail);
const landMarker = new THREE.Group();
{
  const ringM = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ringM.rotation.x = -Math.PI / 2;
  const cross = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), ringM.material);
  cross.rotation.x = -Math.PI / 2;
  const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const drop = new THREE.Line(dropGeo, new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, dashSize: 0.12, gapSize: 0.1 }));
  drop.computeLineDistances();
  landMarker.add(ringM, cross, drop);
  landMarker.userData = { ringM, drop };
  landMarker.position.y = 0.03;
  scene.add(landMarker);
}
const KIND_COLOR = { serve: '#f87171', attack: '#f87171', free: '#fbbf24', pass: '#4ade80', dig: '#4ade80', cover: '#4ade80', block: '#f472b6', set: '#facc15', bounce: '#ffffff' };

const flashes = Array.from({ length: 4 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  return m;
});

// ---------------------------------------------------------------- paths
let paths = [];
const lineMats = [];
function clearPaths() {
  for (const p of paths) { scene.remove(p.full, p.done); p.full.geometry.dispose(); p.done.geometry.dispose(); }
  paths = [];
  lineMats.length = 0;
}
const PATH_DT = 0.04;
function rebuildPaths() {
  clearPaths();
  const tl = built.tl;
  for (const r of OUR_ROLES) {
    if (built.benched.includes(r)) continue;
    const pts = [];
    let moved = false;
    const p0 = tl.pos(r, 0);
    for (let t = 0; t <= tl.end + 1e-6; t += PATH_DT) {
      const p = tl.pos(r, t);
      if (Math.hypot(p[0] - p0[0], p[1] - p0[1]) > 0.05) moved = true;
      pts.push(p[0], 0.05, p[1]);
    }
    if (!moved) continue;
    const color = new THREE.Color(ROLE_INFO[r].color);
    const res = new THREE.Vector2(innerWidth, innerHeight);
    const gFull = new LineGeometry(); gFull.setPositions(pts);
    const mFull = new LineMaterial({ color, linewidth: 2, transparent: true, opacity: 0.35, dashed: true, dashSize: 0.22, gapSize: 0.16, resolution: res, depthWrite: false });
    const full = new Line2(gFull, mFull);
    full.computeLineDistances();
    const gDone = new LineGeometry(); gDone.setPositions(pts);
    const mDone = new LineMaterial({ color, linewidth: 3.5, transparent: true, opacity: 0.95, resolution: res, depthWrite: false });
    const done = new Line2(gDone, mDone);
    full.renderOrder = done.renderOrder = 2;
    scene.add(full, done);
    lineMats.push(mFull, mDone);
    paths.push({ role: r, full, done, n: pts.length / 3 });
  }
}

// ---------------------------------------------------------------- scenario loading
function load(keepTime = false) {
  const prevT = state.t;
  built = buildScenario(state.scenarioId, state.sz, state.seed, state.random);
  state.t = keepTime ? Math.min(prevT, built.tl.end) : 0;
  state.stopAt = null;
  if (!keepTime) setPlaying(true);
  rebuildPaths();
  renderTicks();
  renderRotationUI();
  $('#tEnd').textContent = built.tl.end.toFixed(1);
  const sc = SCENARIOS.find(s => s.id === state.scenarioId);
  document.querySelectorAll('.scn').forEach(b => b.classList.toggle('active', b.dataset.id === state.scenarioId));
  $('#scenarioName').textContent = sc.name;
  $('#mScenario').textContent = sc.name;
  $('#mRot').textContent = 'H' + state.sz;
  lastPhaseIdx = -1;
}

// ---------------------------------------------------------------- UI
function renderRotationUI() {
  document.querySelectorAll('.rot').forEach(b => b.classList.toggle('active', +b.dataset.sz === state.sz));
  const us = built.us;
  const byZone = {};
  for (const [r, z] of Object.entries(us.zoneOf)) byZone[z] = r;
  const sel = selectedRole();
  const rules = sel ? overlapRules(sel) : [];
  $('#zonegrid').innerHTML = [4, 3, 2, 5, 6, 1].map(z => {
    const r = byZone[z];
    const srv = us.server === r ? '<i class="srv" title="Server">serve</i>' : '';
    const hl = state.highlight.has(r) ? ' hl' : '';
    const rule = rules.find(x => x.partner === r);
    const rel = rule ? `<i class="rel">${sel} ${rule.rel}</i>` : '';
    return `<div class="zcell${hl}${rule ? ' partner' : ''}" style="--c:${ROLE_INFO[r].color}" data-role="${r}"><em>${z}</em><b>${r}</b>${srv}${rel}</div>`;
  }).join('');
  $('#overlapInfo').innerHTML = overlapText(sel, rules);
  const legal = $('#legal');
  if (built.legal === null) {
    legal.className = 'badge neutral';
    legal.textContent = 'Mid-rally – overlap rule does not apply';
  } else if (built.legal.length === 0) {
    legal.className = 'badge ok';
    legal.textContent = '✓ Start formation is overlap-legal';
  } else {
    legal.className = 'badge bad';
    legal.textContent = '✗ ' + built.legal.join('; ');
  }
  $('#benchInfo').innerHTML = `Libero ${us.liberoIn ? `in for <b style="color:${ROLE_INFO[us.MB_B].color}">${us.MB_B}</b>` : `<b>off</b> (${us.MB_B} serves)`}`;
}

function buildStaticUI() {
  $('#rotations').innerHTML = [1, 2, 3, 4, 5, 6].map(sz => {
    const z = lineup(sz).S;
    return `<button class="rot" data-sz="${sz}" title="Setter in zone ${z} (${z >= 2 && z <= 4 ? 'front' : 'back'} row)">H${sz}</button>`;
  }).join('');
  document.querySelectorAll('.rot').forEach(b => b.onclick = () => { state.sz = +b.dataset.sz; load(); });

  let html = '', group = '';
  for (const s of SCENARIOS) {
    if (s.group !== group) { if (group) html += '</div>'; group = s.group; html += `<h3>${group}</h3><div class="scn-list">`; }
    html += `<button class="scn" data-id="${s.id}">${s.name}</button>`;
  }
  $('#scenarios').innerHTML = html + '</div>';
  document.querySelectorAll('.scn').forEach(b => b.onclick = () => {
    state.scenarioId = b.dataset.id; load();
    if (isSheet()) closeSheet();
  });

  $('#roles').innerHTML = OUR_ROLES.map(r =>
    `<button class="chip" data-role="${r}" style="--c:${ROLE_INFO[r].color}" title="${ROLE_INFO[r].name}"><i></i>${r}<span>${ROLE_INFO[r].name}</span></button>`).join('')
    + '<button class="chip clear" id="hlClear">Clear</button>';
  document.querySelectorAll('.chip[data-role]').forEach(b => b.onclick = () => toggleHighlight(b.dataset.role));
  $('#hlClear').onclick = () => { state.highlight.clear(); syncHighlightUI(); };
  $('#hlSetter').onclick = () => { state.highlight = new Set(['S']); syncHighlightUI(); };
  $('#hlHitters').onclick = () => { state.highlight = new Set(['OH1', 'OH2', 'OPP', 'MB1', 'MB2']); syncHighlightUI(); };
  $('#hlBack').onclick = () => { state.highlight = new Set(['L', 'OH1', 'OH2']); syncHighlightUI(); };

  const bindToggle = (id, key) => {
    const el = $(id);
    el.checked = state.show[key];
    el.onchange = () => { state.show[key] = el.checked; };
  };
  bindToggle('#tOpp', 'opp'); bindToggle('#tPaths', 'paths'); bindToggle('#tLabels', 'labels'); bindToggle('#tZones', 'zones');
  $('#tAuto').checked = state.autoPause;
  $('#tAuto').onchange = e => { state.autoPause = e.target.checked; };
  $('#tRandom').onchange = e => { state.random = e.target.checked; $('#btnReroll').disabled = !state.random; load(); };
  $('#btnReroll').onclick = () => { state.seed++; if (!state.random) { state.random = true; $('#tRandom').checked = true; } $('#btnReroll').disabled = false; load(); };
  $('#btnReroll').disabled = true;

  $('#views').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}" class="${k === 'behind' ? 'active' : ''}">${v.label}</button>`).join('');
  document.querySelectorAll('#views button').forEach(b => b.onclick = () => flyTo(b.dataset.view));

  $('#btnPlay').onclick = togglePlay;
  $('#btnRestart').onclick = () => { state.t = 0; state.stopAt = null; setPlaying(true); };
  $('#btnPrev').onclick = prevPhase;
  $('#btnNext').onclick = nextPhase;
  $('#btnExplain').onclick = toggleExplain;
  const scrub = $('#scrub');
  scrub.addEventListener('input', () => { state.t = (scrub.value / 1000) * built.tl.end; state.stopAt = null; setPlaying(false); });

  const speed = $('#speed');
  speed.value = state.speed;
  const setSpeed = v => { state.speed = +v; speed.value = v; $('#speedVal').textContent = (+v).toFixed(2).replace(/0$/, '') + '×'; document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', +b.dataset.speed === +v)); };
  speed.oninput = () => setSpeed(speed.value);
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => setSpeed(b.dataset.speed));
  setSpeed(state.speed);

  // Mobile sheet
  $('#menuBtn').onclick = () => document.body.classList.contains('sheet-open') ? closeSheet() : openSheet();
  $('#mTitle').onclick = openSheet;
  $('#sheetBackdrop').onclick = closeSheet;
  $('#sheetClose').onclick = closeSheet;
  $('#phase').onclick = () => { if (isSheet()) $('#phase').classList.toggle('collapsed'); };
  // Swipe down on the sheet handle to close
  let y0 = null;
  $('#sheetHandle').addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  $('#sheetHandle').addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 40) closeSheet(); y0 = null; });

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') nextPhase();
    else if (e.key === 'ArrowLeft') prevPhase();
    else if (e.key >= '1' && e.key <= '6') { state.sz = +e.key; load(); }
    else if (e.key === 'r') { state.t = 0; setPlaying(true); }
    else if (e.key === 'e') toggleExplain();
    else if (e.key === 'Escape') closeSheet();
  });
}
const isSheet = () => matchMedia('(max-width: 760px)').matches;
// The explanation card is hidden until the viewer asks for it.
function toggleExplain() {
  const on = document.body.classList.toggle('explain-on');
  const b = $('#btnExplain');
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', on);
  b.setAttribute('aria-label', on ? 'Hide explanations' : 'Show explanations');
}
function openSheet() { document.body.classList.add('sheet-open'); }
function closeSheet() { document.body.classList.remove('sheet-open'); }

function toggleHighlight(r) {
  if (state.highlight.has(r)) state.highlight.delete(r); else state.highlight.add(r);
  syncHighlightUI();
}
function syncHighlightUI() {
  document.querySelectorAll('.chip[data-role]').forEach(b => b.classList.toggle('active', state.highlight.has(b.dataset.role)));
  renderRotationUI();
}

// ---------------------------------------------------------------- overlap partners
// At the serve contact each player must be in front of / behind their front-back partner
// and left / right of their row neighbours (the server is exempt).
const FB_PAIR = { 4: 5, 3: 6, 2: 1, 5: 4, 6: 3, 1: 2 };
const ROWS = [[4, 3, 2], [5, 6, 1]];
const selectedRole = () => (state.highlight.size === 1 ? [...state.highlight][0] : null);

function overlapRules(role) {
  const us = built.us, z = us.zoneOf[role];
  if (!z || us.server === role || built.serveT == null) return [];
  const byZone = {};
  for (const [r, zz] of Object.entries(us.zoneOf)) byZone[zz] = r;
  const out = [];
  const add = (pz, rel) => { const r = byZone[pz]; if (r && r !== us.server) out.push({ partner: r, zone: pz, rel }); };
  add(FB_PAIR[z], z >= 2 && z <= 4 ? 'in front of' : 'behind');
  const row = ROWS.find(rw => rw.includes(z)), i = row.indexOf(z);
  if (i > 0) add(row[i - 1], 'right of');
  if (i < row.length - 1) add(row[i + 1], 'left of');
  return out;
}
// a = selected player, b = partner, both [x, z] in our frame (smaller z = closer to the net).
function ruleOk(rel, a, b) {
  if (rel === 'in front of') return a[1] < b[1];
  if (rel === 'behind') return a[1] > b[1];
  if (rel === 'left of') return a[0] < b[0];
  return a[0] > b[0];
}
const roleTag = r => `<span class="tag" style="--c:${ROLE_INFO[r].color}">${r}</span>`;
function overlapText(sel, rules) {
  if (!sel) return 'Select one player to see who they must stand in front of, behind or beside when the ball is served.';
  const us = built.us;
  if (built.serveT == null) return 'The overlap rule only applies at the moment of the serve – pick a serve-receive or serving scenario.';
  if (!us.zoneOf[sel]) return `${roleTag(sel)} is on the bench this rally.`;
  if (us.server === sel) return `${roleTag(sel)} is serving, so the overlap rule doesn't apply to them.`;
  return `At the serve ${roleTag(sel)} (zone ${us.zoneOf[sel]}) must be ` +
    rules.map(r => `<b>${r.rel}</b> ${roleTag(r.partner)}`).join(', ') +
    '. Only feet position counts, and the rule ends once the serve is hit.';
}

const ruleViz = Array.from({ length: 3 }, () => {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.07), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));
  bar.renderOrder = 3;
  const div = document.createElement('div');
  div.className = 'rulelabel';
  const label = new CSS2DObject(div);
  scene.add(bar, label);
  return { bar, label, div };
});

function updateRuleViz(t) {
  const sel = selectedRole();
  const active = sel && built.serveT != null && t <= built.serveT + 0.02;
  const rules = active ? overlapRules(sel) : [];
  const partners = new Set();
  ruleViz.forEach((v, i) => {
    const rule = rules[i];
    v.bar.visible = v.label.visible = !!rule;
    if (!rule) return;
    partners.add(rule.partner);
    const a = built.tl.pos(sel, t), b = built.tl.pos(rule.partner, t);
    const ok = ruleOk(rule.rel, a, b);
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    v.bar.position.set((a[0] + b[0]) / 2, 0.06, (a[1] + b[1]) / 2);
    v.bar.scale.x = Math.max(0.01, len - 0.9);
    v.bar.rotation.y = -Math.atan2(dz, dx);
    v.bar.material.color.set(ok ? '#4ade80' : '#f87171');
    v.label.position.set(a[0] + dx * 0.55, 0.35, a[1] + dz * 0.55);
    v.div.className = 'rulelabel ' + (ok ? 'ok' : 'bad');
    v.div.innerHTML = `${sel} <b>${rule.rel}</b> ${rule.partner} ${ok ? '✓' : '✗'}`;
  });
  return partners;
}

function setPlaying(p) {
  state.playing = p;
  $('#btnPlay').innerHTML = p ? ICONS.pause : ICONS.play;
  $('#btnPlay').setAttribute('aria-label', p ? 'Pause' : 'Play');
}
function togglePlay() {
  if (!state.playing && state.t >= built.tl.end - 1e-3) state.t = 0;
  state.stopAt = null;
  setPlaying(!state.playing);
}
function phaseIndex(t) {
  const ph = built.tl.phases;
  let idx = 0;
  for (let i = 0; i < ph.length; i++) if (ph[i].t <= t + 1e-4) idx = i;
  return idx;
}
function nextPhase() {
  const ph = built.tl.phases, i = phaseIndex(state.t);
  if (i + 1 >= ph.length) return;
  state.t = ph[i + 1].t;
  state.stopAt = i + 2 < ph.length ? ph[i + 2].t : null;
  setPlaying(true);
}
function prevPhase() {
  const ph = built.tl.phases, i = phaseIndex(state.t);
  const target = state.t - ph[i].t > 0.4 || i === 0 ? i : i - 1;
  state.t = ph[target].t;
  state.stopAt = null;
  setPlaying(false);
}

function renderTicks() {
  const { phases, end } = built.tl;
  $('#ticks').innerHTML = phases.map((p, i) => `<button class="tick" style="left:${(p.t / end) * 100}%" data-i="${i}" title="${p.title}"></button>`).join('');
  document.querySelectorAll('.tick').forEach(b => b.onclick = () => {
    state.t = phases[+b.dataset.i].t;
    state.stopAt = null;
    setPlaying(false);
  });
}

let lastPhaseIdx = -1, lastRuleHtml = null;
function updateHUD() {
  const { phases, end } = built.tl;
  const i = phaseIndex(state.t);
  if (i !== lastPhaseIdx) {
    lastPhaseIdx = i;
    const p = phases[i];
    $('#phaseIdx').textContent = `${i + 1} / ${phases.length}`;
    $('#phaseTitle').textContent = p.title;
    $('#phaseText').innerHTML = p.text;
    $('#phase').classList.remove('flash'); void $('#phase').offsetWidth; $('#phase').classList.add('flash');
    document.querySelectorAll('.tick').forEach((b, k) => { b.classList.toggle('past', k <= i); b.classList.toggle('current', k === i); });
  }
  // Overlap hint for a single selected player (also visible on phones, where the panel is hidden).
  const sel = selectedRole();
  const ruleHtml = sel && built.serveT != null && state.t <= built.serveT + 0.02 && overlapRules(sel).length
    ? '🧭 ' + overlapText(sel, overlapRules(sel)) : '';
  if (ruleHtml !== lastRuleHtml) {
    lastRuleHtml = ruleHtml;
    $('#phaseRule').innerHTML = ruleHtml;
    $('#phaseRule').hidden = !ruleHtml;
  }
  $('#scrub').value = Math.round((state.t / end) * 1000);
  $('#scrub').style.setProperty('--p', `${(state.t / end) * 100}%`);
  $('#tNow').textContent = state.t.toFixed(1);
}

// ---------------------------------------------------------------- camera
let fly = null;
function flyTo(name) {
  const v = VIEWS[name];
  fly = { t: 0, dur: 1.1, p0: camera.position.clone(), p1: viewPos(v), q0: controls.target.clone(), q1: new THREE.Vector3(...v.target) };
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  state.view = name;
}
state.view = 'behind';

// Tap / click a player to highlight
{
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(players.filter(p => !p.isOpp && p.g.visible).map(p => p.sphere));
    if (hits.length) toggleHighlight(hits[0].object.userData.role);
  });
}

// ---------------------------------------------------------------- frame update
const clock = { last: performance.now() };
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpV = new THREE.Vector3();

function updateScene(t, now) {
  const tl = built.tl;
  const hasHL = state.highlight.size > 0;
  const partners = updateRuleViz(t);
  const phase = tl.phases[phaseIndex(t)];
  const focus = new Set(phase?.focus || []);
  const pulseU = (now / 1000 * 1.2) % 1;

  for (const P of players) {
    const benched = built.benched.includes(P.id);
    const visible = P.isOpp ? state.show.opp && !benched : true;
    P.g.visible = visible;
    P.lab.visible = visible && state.show.labels;
    if (!visible) continue;
    const [x, z] = tl.pos(P.id, t);
    const y = tl.height(P.id, t);
    P.g.position.set(x, 0, z);
    P.sphere.position.y = BODY_Y + y;
    P.stem.scale.y = BODY_Y + y - 0.28;
    P.lab.position.y = BODY_Y + y + 0.62;
    const hl = !P.isOpp && state.highlight.has(P.role);
    let op = 1;
    if (benched) op = 0.3;
    else if (hasHL && !hl) op = P.isOpp ? 0.3 : 0.25;
    else if (P.isOpp) op = 0.8;
    P.mats[0].opacity = op;
    P.mats[1].opacity = 0.9 * op;
    P.mats[2].opacity = 0.45 * op;
    P.sphere.scale.setScalar(hl ? 1.3 : 1);
    P.mats[0].emissiveIntensity = hl ? 0.9 : 0.3;
    P.div.style.opacity = op < 1 ? Math.min(1, op + 0.15) : 1;
    const partner = !P.isOpp && partners.has(P.role);
    if (partner) { op = Math.max(op, 0.85); P.mats[0].opacity = op; P.mats[1].opacity = 0.9 * op; P.div.style.opacity = 1; }
    P.div.classList.toggle('hl', hl);
    P.div.classList.toggle('partner', partner);
    const pulsing = !benched && (hl || partner || (!P.isOpp && focus.has(P.id)));
    P.pulse.visible = pulsing;
    if (pulsing) {
      const u = (pulseU + (hl ? 0 : 0.5)) % 1;
      P.pulse.scale.setScalar(1 + u * 1.3);
      P.pulse.material.opacity = (1 - u) * (hl ? 0.9 : 0.6);
    }
  }

  // Ball
  const bp = tl.ballPos(t);
  const by = Math.max(bp[1], BALL_R);
  ball.position.set(bp[0], by, bp[2]);
  ball.rotation.set(t * 9, t * 4, 0);
  ballGlow.position.copy(ball.position);
  ballShadow.position.set(bp[0], 0.03, bp[2]);
  const sh = 1 / (1 + by * 0.25);
  ballShadow.scale.setScalar(sh);
  ballShadow.material.opacity = 0.5 * sh;
  for (let i = 0; i < TRAIL_N; i++) {
    const q = tl.ballPos(t - (i + 1) * 0.018);
    const moving = Math.hypot(q[0] - bp[0], q[1] - bp[1], q[2] - bp[2]) > 0.02;
    const s = moving ? (1 - i / TRAIL_N) * 0.85 : 0;
    tmpM.compose(tmpV.set(q[0], Math.max(q[1], BALL_R), q[2]), tmpQ, tmpS.set(s, s, s));
    trail.setMatrixAt(i, tmpM);
  }
  trail.instanceMatrix.needsUpdate = true;

  const seg = tl.inFlight(t);
  landMarker.visible = !!seg && seg.kind !== 'toss' && seg.kind !== 'bounce';
  if (landMarker.visible) {
    const { ringM, drop } = landMarker.userData;
    landMarker.position.set(seg.to[0], 0.03, seg.to[2]);
    ringM.material.color.set(KIND_COLOR[seg.kind] || '#fff');
    const u = (now / 1000 * 2) % 1;
    ringM.scale.setScalar(1 + 0.25 * Math.sin(u * Math.PI * 2));
    drop.scale.y = Math.max(0.01, seg.to[1]);
    drop.visible = seg.to[1] > 0.2;
  }

  // Contact flashes
  let fi = 0;
  for (const s of tl.ballSegs) {
    if (s.kind === 'toss' || fi >= flashes.length) continue;
    const age = t - s.t0;
    if (age < 0 || age > 0.5) continue;
    const f = flashes[fi++];
    f.visible = true;
    f.position.set(s.from[0], Math.max(s.from[1], 0.05), s.from[2]);
    const u = age / 0.5;
    f.scale.setScalar(0.6 + u * (s.kind === 'bounce' ? 6 : 3));
    f.material.color.set(KIND_COLOR[s.kind === 'bounce' ? 'serve' : s.kind] || '#fff');
    f.material.opacity = 1 - u;
    if (s.kind === 'bounce') f.rotation.set(-Math.PI / 2, 0, 0);
    else f.quaternion.copy(camera.quaternion);
  }
  for (; fi < flashes.length; fi++) flashes[fi].visible = false;

  // Paths
  const idx = Math.floor(t / PATH_DT) + 1;
  for (const p of paths) {
    const vis = state.show.paths && (!hasHL || state.highlight.has(p.role));
    p.full.visible = p.done.visible = vis;
    p.done.geometry.instanceCount = Math.max(0, Math.min(p.n - 1, idx));
  }
  zoneLayer.visible = state.show.zones;
}

function frame(now) {
  const dt = Math.min(0.1, (now - clock.last) / 1000);
  clock.last = now;
  if (state.playing) {
    const prev = state.t;
    let next = state.t + dt * state.speed;
    if (state.stopAt != null && next >= state.stopAt) { next = state.stopAt; state.stopAt = null; setPlaying(false); }
    else if (state.autoPause) {
      const p = built.tl.phases.find(ph => ph.t > prev + 1e-4 && ph.t <= next);
      if (p) { next = p.t; setPlaying(false); }
    }
    if (next >= built.tl.end) { next = built.tl.end; setPlaying(false); }
    state.t = next;
  }
  if (fly) {
    fly.t += dt;
    const u = Math.min(1, fly.t / fly.dur), e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.q0, fly.q1, e);
    if (u >= 1) fly = null;
  }
  updateScene(state.t, now);
  updateHUD();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const m of lineMats) m.resolution.set(w, h);
}
addEventListener('resize', () => { resize(); if (!fly) flyTo(state.view); });

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
};

buildStaticUI();
resize();
load();
requestAnimationFrame(t => { clock.last = t; frame(t); });
setTimeout(() => $('#loading').classList.add('hidden'), 150);
