// multi-vis.js
// "Why Multi-Agent SLAM?" viewer. Camera is auto-framed only on the FIRST load
// (which is the combined/all mesh). Subsequent thumbnail clicks swap the mesh
// without moving the camera, so the viewer reveals how much each individual
// agent observes vs. the multi-agent fusion under the same viewpoint.

const SCENES = [
    { name: '7scenes_file_all',    label: 'Multi-Agent Fusion' },
    { name: '7scenes_file_agent1', label: 'Agent 1 only' },
    { name: '7scenes_file_agent2', label: 'Agent 2 only' },
    { name: '7scenes_file_agent3', label: 'Agent 3 only' },
    { name: '7scenes_file_agent4', label: 'Agent 4 only' },
];

function init() {
    const root = document.getElementById('multi-vis');
    if (!root) return;

    const thumbnailsHtml = SCENES.map(s => `
        <img src="static/thumbs/${s.name}.png"
             data-scene="${s.name}"
             data-label="${s.label}"
             class="thumbnail multi-thumbnail"
             alt="${s.name}"
             title="${s.label}"
             style="cursor: pointer; width: 100px;">
    `).join('');

    root.innerHTML = `
        <div class="container" style="max-width: 95%; width: 95%;">
            <div class="columns is-centered has-text-centered">
                <div class="column is-full panel-style">
                    <div style="width: 100%; max-width: none;">
                        <div style="display: flex; justify-content: center; width: 100%;">
                            <div id="multi-viewer-container"
                                 style="width: 95%; position: relative; background-color: #ffffff; aspect-ratio: 16/9; border-radius: 4px; overflow: hidden;">
                                <canvas id="multi-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
                                <div id="multi-status"
                                     style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #333; font-size: 15px; padding: 0 20px; text-align: center; background-color: rgba(255,255,255,0.9); pointer-events: none;">
                                    Initializing 3D viewer…
                                </div>
                                <div id="multi-hint"
                                     style="position: absolute; left: 12px; bottom: 10px; color: #555; font-size: 12px; background: rgba(255,255,255,0.7); padding: 3px 8px; border-radius: 4px; pointer-events: none;">
                                    Drag to rotate · Right-drag to pan · Scroll to zoom
                                </div>
                            </div>
                        </div>
                        <div id="multi-scene-label"
                             style="text-align: center; font-size: 1.1rem; font-weight: 600; margin-top: 12px; color: #363636;"></div>
                    </div>
                    <div class="thumbnail-container">
                        ${thumbnailsHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
    root.style.display = 'block';

    const statusEl = document.getElementById('multi-status');
    const setStatus = (msg, isError) => {
        if (!statusEl) return;
        statusEl.style.display = 'flex';
        statusEl.style.color = isError ? '#a3372b' : '#333';
        statusEl.innerHTML = msg;
    };

    if (location.protocol === 'file:') {
        setStatus(
            'This viewer needs to be served over HTTP — opening the page via <code>file://</code> blocks the GLB fetches.<br><br>' +
            'Try: <code>python3 -m http.server 8000</code>, then visit <code>http://localhost:8000/</code>.',
            true,
        );
        return;
    }

    Promise.all([
        import('three'),
        import('three/addons/controls/TrackballControls.js'),
        import('three/addons/loaders/GLTFLoader.js'),
    ]).then(([THREEmod, TCmod, GLmod]) => {
        startViewer(root, THREEmod, TCmod.TrackballControls, GLmod.GLTFLoader, setStatus);
    }).catch(err => {
        console.error('three.js import failed:', err);
        setStatus('Failed to load three.js: ' + (err && err.message ? err.message : err), true);
    });
}

function startViewer(root, THREE, TrackballControls, GLTFLoader, setStatus) {
    const canvas = document.getElementById('multi-canvas');
    const viewerEl = document.getElementById('multi-viewer-container');
    const labelEl = document.getElementById('multi-scene-label');
    const thumbs = root.querySelectorAll('.multi-thumbnail');

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (e) {
        setStatus('WebGL is not available: ' + (e && e.message ? e.message : e), true);
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xffffff, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(2, 2, 2);

    const controls = new TrackballControls(camera, canvas);
    controls.rotateSpeed = 3.5;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.15;

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.25);
    dir2.position.set(-4, -2, -3);
    scene.add(dir2);

    function resize() {
        const w = viewerEl.clientWidth;
        const h = viewerEl.clientHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        controls.handleResize();
    }
    resize();
    new ResizeObserver(resize).observe(viewerEl);
    window.addEventListener('resize', resize);

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();

    let currentGroup = null;
    let cameraFramed = false;
    let sceneRadius = 1.0;
    const loader = new GLTFLoader();

    function disposeGroup(g) {
        if (!g) return;
        g.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        scene.remove(g);
    }

    function frameCamera(box) {
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const radius = size.length() * 0.5;
        if (!isFinite(radius) || radius <= 0) return;
        const fov = camera.fov * Math.PI / 180;
        const dist = radius / Math.tan(fov / 2) * 1.6;
        const dirVec = new THREE.Vector3(1, 0.7, 1).normalize();
        camera.position.copy(center.clone().add(dirVec.multiplyScalar(dist)));
        camera.near = Math.max(radius * 0.001, 0.001);
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.update();
    }

    async function loadScene(name) {
        setStatus('Loading…', false);
        if (currentGroup) {
            disposeGroup(currentGroup);
            currentGroup = null;
        }
        const group = new THREE.Group();

        const gltf = await loader.loadAsync('static/meshes/' + name + '.glb');
        gltf.scene.traverse(obj => {
            if (obj.isMesh) {
                obj.material = new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    metalness: 0.0,
                    roughness: 0.95,
                    side: THREE.DoubleSide,
                });
            }
        });
        group.add(gltf.scene);

        try {
            const r = await fetch('static/trajs/' + name + '.json');
            if (r.ok) {
                const traj = await r.json();
                for (const agent of (traj.agents || [])) {
                    if (!agent.points || agent.points.length < 2) continue;
                    const positions = new Float32Array(agent.points.length * 3);
                    for (let i = 0; i < agent.points.length; i++) {
                        positions[i * 3]     = agent.points[i][0];
                        positions[i * 3 + 1] = agent.points[i][1];
                        positions[i * 3 + 2] = agent.points[i][2];
                    }
                    const geom = new THREE.BufferGeometry();
                    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    const c = agent.color || [0, 0, 0];
                    const lineColor = new THREE.Color(c[0], c[1], c[2]);
                    const lineMat = new THREE.LineBasicMaterial({ color: lineColor, depthTest: true });
                    group.add(new THREE.Line(geom, lineMat));

                    const sphereR = sceneRadius * 0.005;
                    const sphereGeom = new THREE.SphereGeometry(sphereR, 12, 12);
                    const sphereMat = new THREE.MeshBasicMaterial({ color: lineColor });
                    const start = new THREE.Mesh(sphereGeom, sphereMat);
                    start.position.set(agent.points[0][0], agent.points[0][1], agent.points[0][2]);
                    const lp = agent.points[agent.points.length - 1];
                    const end = new THREE.Mesh(sphereGeom.clone(), sphereMat);
                    end.position.set(lp[0], lp[1], lp[2]);
                    group.add(start);
                    group.add(end);
                }
            }
        } catch (e) {
            console.warn('Trajectory load failed for', name, e);
        }

        scene.add(group);
        currentGroup = group;

        if (!cameraFramed) {
            const box = new THREE.Box3().setFromObject(group);
            const sz = new THREE.Vector3();
            box.getSize(sz);
            sceneRadius = Math.max(sz.x, sz.y, sz.z);
            frameCamera(box);
            cameraFramed = true;
        }

        document.getElementById('multi-status').style.display = 'none';
    }

    function selectThumb(thumb) {
        thumbs.forEach(t => t.style.border = '2px solid #fff');
        thumb.style.border = '3px solid #92A8D1';
        labelEl.textContent = thumb.dataset.label;
        loadScene(thumb.dataset.scene).catch(err => {
            console.error(err);
            setStatus('Failed to load: ' + (err && err.message ? err.message : err), true);
        });
    }

    thumbs.forEach(thumb => {
        thumb.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (thumb.style.border.includes('3px solid')) return;
            selectThumb(thumb);
        });
    });

    selectThumb(thumbs[0]); // start with "all"
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
