// viewer.js
// Shared three.js viewer for the MAGS-SLAM project page. It shows a fused TSDF
// mesh together with the per-agent camera trajectories.
//
// The exported meshes live in the first camera's OpenCV frame (y down), carry
// sRGB vertex colours and no normals. On load we therefore
//   1. convert the colours to linear so the sRGB output pass reproduces them,
//   2. orient every face towards the cameras that observed it, so back-face
//      culling removes ceilings and near walls and indoor scenes open up like
//      a dollhouse,
//   3. estimate gravity from the dominant horizontal surfaces and rotate the
//      scene upright, so orbiting always keeps the floor below.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

// Agent colours follow the paper figures (blue, red, green, orange).
export const AGENT_COLORS = ['#2f6fde', '#dd3b30', '#2c9b55', '#ee9418'];

const CLAY = new THREE.Color('#e6e1d8');
const GHOST = new THREE.Color('#7b8593');
const VIEW_DIR = new THREE.Vector3(-0.55, 0.95, 1.0).normalize();

function srgbToLinear(c) { return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4); }
const SRGB_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) SRGB_LUT[i] = srgbToLinear(i / 255);

const loader = new GLTFLoader();

function fetchGLB(url, onProgress) {
    return new Promise((resolve, reject) => {
        loader.load(url, resolve, e => {
            if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        }, reject);
    });
}

async function fetchTrajectories(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return [];
        const data = await r.json();
        return (data.agents || []).filter(a => a.points && a.points.length > 1);
    } catch (e) {
        console.warn('Trajectory load failed:', url, e);
        return [];
    }
}

function firstGeometry(gltf) {
    let geom = null;
    gltf.scene.traverse(o => { if (!geom && o.isMesh) geom = o.geometry; });
    return geom;
}

function linearizeColors(geom) {
    const c = geom.getAttribute('color');
    if (!c) return;
    const n = c.count, out = new Float32Array(n * 3);
    if (c.array instanceof Uint8Array) {
        const a = c.array, s = c.itemSize;
        for (let i = 0; i < n; i++) {
            out[i * 3] = SRGB_LUT[a[i * s]];
            out[i * 3 + 1] = SRGB_LUT[a[i * s + 1]];
            out[i * 3 + 2] = SRGB_LUT[a[i * s + 2]];
        }
    } else {
        for (let i = 0; i < n; i++) {
            out[i * 3] = srgbToLinear(c.getX(i));
            out[i * 3 + 1] = srgbToLinear(c.getY(i));
            out[i * 3 + 2] = srgbToLinear(c.getZ(i));
        }
    }
    autoExpose(out);
    geom.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

// TSDF colours of some sequences are fused much darker than the input images.
// Apply one global gain in linear space so the median luminance reaches a
// mid-grey, which keeps relative colours intact.
function autoExpose(lin) {
    const lum = [];
    for (let i = 0; i < lin.length; i += 3 * 7) lum.push(0.2126 * lin[i] + 0.7152 * lin[i + 1] + 0.0722 * lin[i + 2]);
    lum.sort((a, b) => a - b);
    const median = lum[lum.length >> 1];
    if (!(median > 0)) return;
    const gain = Math.min(4.5, Math.max(1, srgbToLinear(0.5) / median));
    if (gain <= 1.05) return;
    for (let i = 0; i < lin.length; i++) lin[i] = Math.min(1, lin[i] * gain);
}

// Flip the winding when most sampled faces point away from the nearest camera.
function orientTowardsCameras(geom, trajectories) {
    const cams = [];
    for (const t of trajectories) {
        const step = Math.max(1, Math.floor(t.points.length / 150));
        for (let i = 0; i < t.points.length; i += step) cams.push(t.points[i]);
    }
    if (!cams.length) return;
    const pos = geom.attributes.position.array, idx = geom.index.array;
    const nTri = idx.length / 3, step = Math.max(1, Math.floor(nTri / 3000));
    let facing = 0, total = 0;
    for (let t = 0; t < nTri; t += step) {
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const cx = (pos[a] + pos[b] + pos[c]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
        let best = Infinity, bx = 0, by = 0, bz = 0;
        for (const p of cams) {
            const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2;
            if (d < best) { best = d; bx = p[0] - cx; by = p[1] - cy; bz = p[2] - cz; }
        }
        facing += Math.sign(nx * bx + ny * by + nz * bz);
        total++;
    }
    if (total && facing < 0) {
        for (let t = 0; t < idx.length; t += 3) {
            const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
        }
        geom.index.needsUpdate = true;
    }
}

// Area-weighted mean normal of the near-horizontal faces, starting from the
// OpenCV up direction (-y) and refined once.
function estimateUp(geom) {
    const pos = geom.attributes.position.array, idx = geom.index.array;
    let up = new THREE.Vector3(0, -1, 0);
    for (const cosMin of [0.8, 0.95]) {
        const acc = new THREE.Vector3();
        for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
            const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz);
            if (len === 0) continue;
            const d = (nx * up.x + ny * up.y + nz * up.z) / len;
            if (Math.abs(d) < cosMin) continue;
            if (d < 0) { nx = -nx; ny = -ny; nz = -nz; }
            acc.x += nx; acc.y += ny; acc.z += nz;
        }
        if (acc.lengthSq() > 0) up = acc.normalize();
    }
    return up;
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }

export class Viewer {
    constructor(el) {
        this.el = el;
        this.canvas = el.querySelector('canvas');
        this.loadingEl = el.querySelector('.viewer-loading');
        this.barEl = el.querySelector('.viewer-progress span');
        this.toastEl = el.querySelector('.viewer-toast');
        this.legendEl = el.querySelector('.viewer-legend');

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setClearColor(0xf1f2f4, 1);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 1000);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6a62, 1.9));
        const head = new THREE.DirectionalLight(0xffffff, 1.4);
        head.position.set(0.3, 0.6, 1);
        this.camera.add(head);
        this.scene.add(this.camera);

        // All content goes into `world`, which carries the gravity alignment.
        this.world = new THREE.Group();
        this.scene.add(this.world);

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.09;
        this.controls.rotateSpeed = 0.8;
        this.controls.zoomSpeed = 0.9;
        this.controls.screenSpacePanning = true;
        this.controls.addEventListener('change', () => this.requestRender());

        this.shading = 'color';
        this.showTrajectories = true;
        this.progress = 1;
        this.lineMaterials = [];
        this.home = null;
        this.tween = null;
        this.dirty = true;
        this.visible = false;

        this._guardWheel();
        this._observe();
    }

    // Plain scrolling passes through to the page. Zoom needs Ctrl or Cmd, or a
    // click inside the viewer first.
    _guardWheel() {
        let engaged = false, timer = null;
        this.el.addEventListener('pointerdown', () => { engaged = true; });
        this.el.addEventListener('pointerleave', () => { engaged = false; });
        this.el.addEventListener('wheel', e => {
            const full = document.fullscreenElement && document.fullscreenElement.contains(this.el);
            if (engaged || e.ctrlKey || e.metaKey || full) return;
            e.stopPropagation();
            if (!this.toastEl) return;
            this.toastEl.classList.add('is-on');
            clearTimeout(timer);
            timer = setTimeout(() => this.toastEl.classList.remove('is-on'), 1400);
        }, { capture: true });
    }

    _observe() {
        const resize = () => {
            const w = this.el.clientWidth, h = this.el.clientHeight;
            if (!w || !h) return;
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            for (const m of this.lineMaterials) m.resolution.set(w, h);
            this.requestRender();
        };
        new ResizeObserver(resize).observe(this.el);
        resize();
        new IntersectionObserver(entries => {
            this.visible = entries[0].isIntersecting;
            if (this.visible) this._loop();
        }).observe(this.el);
    }

    _loop() {
        if (this._running) return;
        this._running = true;
        const tick = now => {
            if (!this.visible) { this._running = false; return; }
            if (this.tween) this._stepTween(now);
            if (this.onFrame) this.onFrame(now);
            const moved = this.controls.update();
            if (moved || this.dirty) {
                this.renderer.render(this.scene, this.camera);
                this.dirty = false;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    requestRender() { this.dirty = true; }

    setProgress(p) {
        if (!this.loadingEl) return;
        this.loadingEl.classList.toggle('is-on', p < 1);
        if (this.barEl) this.barEl.style.width = (Math.max(0.04, p) * 100).toFixed(1) + '%';
    }

    showError(msg) {
        this.el.classList.add('has-error');
        const box = this.el.querySelector('.viewer-error');
        if (box) box.textContent = msg;
    }

    // Load one mesh plus its trajectories and return a reusable layer.
    async loadLayer(name, { alignFrom = true, agentOffset = 0 } = {}) {
        const [gltf, trajs] = await Promise.all([
            fetchGLB(`static/meshes/${name}.glb`, p => this.setProgress(p * 0.98)),
            fetchTrajectories(`static/trajs/${name}.json`),
        ]);
        const geom = firstGeometry(gltf);
        linearizeColors(geom);
        orientTowardsCameras(geom, trajs);
        geom.computeVertexNormals();
        geom.computeBoundingBox();

        const colorMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide });
        const clayMat = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.92, metalness: 0, side: THREE.FrontSide });
        const ghostMat = new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.FrontSide });
        const mesh = new THREE.Mesh(geom, colorMat);

        const group = new THREE.Group();
        group.add(mesh);
        const size = geom.boundingBox.getSize(new THREE.Vector3()).length();
        const tracks = trajs.map((t, i) => this._makeTrack(t, AGENT_COLORS[(i + agentOffset) % AGENT_COLORS.length], size));
        for (const tr of tracks) group.add(tr.group);

        const layer = { name, group, mesh, geom, colorMat, clayMat, ghostMat, tracks, ghost: false };
        if (alignFrom) layer.up = estimateUp(geom);
        this.setProgress(1);
        return layer;
    }

    _makeTrack(agent, color, sceneSize) {
        const flat = [];
        for (const p of agent.points) flat.push(p[0], p[1], p[2]);
        const geom = new LineGeometry();
        geom.setPositions(flat);
        const mat = new LineMaterial({ color, linewidth: 2.6, worldUnits: false });
        mat.resolution.set(this.el.clientWidth || 1, this.el.clientHeight || 1);
        this.lineMaterials.push(mat);
        const line = new Line2(geom, mat);
        line.computeLineDistances();

        const r = sceneSize * 0.0065;
        const dotGeom = new THREE.SphereGeometry(r, 20, 14);
        const start = new THREE.Mesh(dotGeom, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        const ring = new THREE.Mesh(new THREE.SphereGeometry(r * 1.45, 20, 14), new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
        start.position.fromArray(agent.points[0]);
        ring.position.copy(start.position);
        const headDot = new THREE.Mesh(new THREE.SphereGeometry(r * 1.35, 20, 14), new THREE.MeshBasicMaterial({ color }));
        headDot.position.fromArray(agent.points[agent.points.length - 1]);

        const group = new THREE.Group();
        group.add(line, start, ring, headDot);
        return { group, line, geom, headDot, points: agent.points, color };
    }

    // Rotate the world so that `up` maps to +y.
    align(up) {
        this.world.quaternion.setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
        this.world.updateMatrixWorld(true);
    }

    show(layers) {
        this.world.clear();
        for (const l of layers) this.world.add(l.group);
        this.active = layers;
        this.applyStyle();
    }

    applyStyle() {
        for (const l of this.active || []) {
            l.mesh.material = l.ghost ? l.ghostMat : (this.shading === 'color' ? l.colorMat : l.clayMat);
            l.mesh.renderOrder = l.ghost ? 1 : 0;
            for (const t of l.tracks) t.group.visible = this.showTrajectories && !l.ghost;
        }
        this.setReplay(this.progress);
    }

    setShading(mode) { this.shading = mode; this.applyStyle(); }
    setTrajectories(on) { this.showTrajectories = on; this.applyStyle(); }

    // Reveal each trajectory up to fraction p of its length.
    setReplay(p) {
        this.progress = p;
        for (const l of this.active || []) {
            for (const t of l.tracks) {
                const n = t.points.length;
                const k = Math.max(1, Math.round(p * (n - 1)));
                t.geom.instanceCount = k;
                t.headDot.position.fromArray(t.points[k]);
            }
        }
        this.requestRender();
    }

    // Frame the given layer from a fixed three-quarter view. Sampled vertices
    // are projected into the view, then the target is shifted and the distance
    // scaled until they fill the frame with a margin. The bounding box alone is
    // a poor guide because culled ceilings leave its upper part empty.
    frame(layer, animate = false) {
        this.world.updateMatrixWorld(true);
        const pos = layer.geom.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 4000));
        const pts = [];
        const box = new THREE.Box3();
        for (let i = 0; i < pos.count; i += step) {
            const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(layer.mesh.matrixWorld);
            pts.push(p);
            box.expandByPoint(p);
        }
        for (const t of layer.tracks) {
            for (let i = 0; i < t.points.length; i += 5) {
                pts.push(new THREE.Vector3().fromArray(t.points[i]).applyMatrix4(layer.mesh.matrixWorld));
            }
        }
        const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
        const target = box.getCenter(new THREE.Vector3());
        let dist = radius * 2.2;

        const cam = this.camera.clone();
        cam.aspect = this.camera.aspect;
        cam.near = radius * 0.002;
        cam.far = radius * 60;
        cam.updateProjectionMatrix();
        const right = new THREE.Vector3(), up = new THREE.Vector3(), v = new THREE.Vector3();
        for (let it = 0; it < 4; it++) {
            cam.position.copy(target).addScaledVector(VIEW_DIR, dist);
            cam.lookAt(target);
            cam.updateMatrixWorld(true);
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (const p of pts) {
                v.copy(p).project(cam);
                if (v.z > 1) continue;
                x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
                y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
            }
            // Shift the target by the screen-space offset of the bounds centre.
            const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tanX = tanY * cam.aspect;
            right.setFromMatrixColumn(cam.matrixWorld, 0);
            up.setFromMatrixColumn(cam.matrixWorld, 1);
            target.addScaledVector(right, (x0 + x1) / 2 * tanX * dist);
            target.addScaledVector(up, (y0 + y1) / 2 * tanY * dist);
            dist *= Math.max((x1 - x0) / 2 / 0.86, (y1 - y0) / 2 / 0.8);
        }

        this.camera.near = cam.near;
        this.camera.far = cam.far;
        this.camera.updateProjectionMatrix();
        this.controls.minDistance = radius * 0.05;
        this.controls.maxDistance = radius * 8;
        this.home = { pos: target.clone().addScaledVector(VIEW_DIR, dist), target };
        this.goHome(animate);
    }

    goHome(animate = true) {
        if (!this.home) return;
        if (!animate) {
            this.camera.position.copy(this.home.pos);
            this.controls.target.copy(this.home.target);
            this.controls.update();
            this.requestRender();
            return;
        }
        this.tween = {
            t0: performance.now(), dur: 700,
            fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(),
            toPos: this.home.pos.clone(), toTarget: this.home.target.clone(),
        };
        this._loop();
    }

    _stepTween(now) {
        const tw = this.tween;
        const k = easeInOut(Math.min(1, (now - tw.t0) / tw.dur));
        this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
        this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
        this.requestRender();
        if (k >= 1) this.tween = null;
    }

    setLegend(items) {
        if (!this.legendEl) return;
        this.legendEl.innerHTML = items.map(it =>
            `<span><i style="background:${it.color}"></i>${it.label}</span>`).join('');
    }
}
