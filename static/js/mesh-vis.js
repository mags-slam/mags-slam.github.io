// mesh-vis.js
// Renders the interactive mesh + trajectory viewer. Three.js is imported
// dynamically so that even if the CDN / importmap fails (e.g. opened via
// file://) we can show a meaningful error in the viewer area instead of
// silently leaving an empty section.

const SCENES = [
    { name: 'replica_apart0',       label: 'ReplicaMultiAgent Apart 0',       thumb: 'static/thumbs/replica_apart0.jpg' },
    { name: 'replica_office0',      label: 'ReplicaMultiAgent Office 0',      thumb: 'static/thumbs/replica_office0.jpg' },
    { name: 'replica_plus_room0',   label: 'ReplicaMultiAgent Plus Room 0',   thumb: 'static/thumbs/replica_plus_room0.png' },
    { name: 'replica_plus_office2', label: 'ReplicaMultiAgent Plus Office 2', thumb: 'static/thumbs/replica_plus_office2.png' },
    { name: 'eth3d_planar',         label: 'ETH3D Planar',                    thumb: 'static/thumbs/eth3d_planar.png' },
    { name: 'eth3d_plant_scene',    label: 'ETH3D Plant Scene',               thumb: 'static/thumbs/eth3d_plant_scene.png' },
    { name: 'tnt_truck',            label: 'Tanks and Temples Truck',         thumb: 'static/thumbs/tnt_truck.jpg' },
    { name: 'tnt_ignatius',         label: 'Tanks and Temples Ignatius',      thumb: 'static/thumbs/tnt_ignatius.jpg' },
];

function init() {
    const root = document.getElementById('mesh-vis');
    if (!root) return;

    const thumbnailsHtml = SCENES.map(s => `
        <img src="${s.thumb}"
             data-scene="${s.name}"
             data-label="${s.label}"
             class="thumbnail mesh-thumbnail"
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
                            <div id="mesh-viewer-container"
                                 style="width: 95%; position: relative; background-color: #ffffff; aspect-ratio: 16/9; border-radius: 4px; overflow: hidden;">
                                <canvas id="mesh-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
                                <div id="mesh-status"
                                     style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #333; font-size: 15px; padding: 0 20px; text-align: center; background-color: rgba(255,255,255,0.9); pointer-events: none;">
                                    Initializing 3D viewer…
                                </div>
                                <div id="mesh-hint"
                                     style="position: absolute; left: 12px; bottom: 10px; color: #555; font-size: 12px; background: rgba(255,255,255,0.7); padding: 3px 8px; border-radius: 4px; pointer-events: none;">
                                    Drag to rotate · Right-drag to pan · Scroll to zoom
                                </div>
                            </div>
                        </div>
                        <div id="mesh-scene-label"
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

    const statusEl = document.getElementById('mesh-status');
    const setStatus = (msg, isError) => {
        if (!statusEl) return;
        statusEl.style.display = 'flex';
        statusEl.style.color = isError ? '#a3372b' : '#333';
        statusEl.innerHTML = msg;
    };

    if (location.protocol === 'file:') {
        setStatus(
            'This viewer needs to be served over HTTP — opening the page via <code>file://</code> blocks the GLB/JSON fetches.<br><br>' +
            'Try running:<br><code>python3 -m http.server 8000</code><br>then open <code>http://localhost:8000/</code>.',
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
        setStatus(
            'Failed to load three.js from the CDN. Check the network tab for blocked requests.<br>' +
            '<small>' + (err && err.message ? err.message : err) + '</small>',
            true,
        );
    });
}

function startViewer(root, THREE, TrackballControls, GLTFLoader, setStatus) {
    const canvas = document.getElementById('mesh-canvas');
    const viewerEl = document.getElementById('mesh-viewer-container');
    const labelEl = document.getElementById('mesh-scene-label');
    const thumbs = root.querySelectorAll('.mesh-thumbnail');

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (e) {
        setStatus('WebGL is not available in this browser: ' + (e && e.message ? e.message : e), true);
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
    const loader = new GLTFLoader();

    function disposeGroup(group) {
        if (!group) return;
        group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        scene.remove(group);
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
        setStatus('Loading ' + name + '…', false);
        if (currentGroup) {
            disposeGroup(currentGroup);
            currentGroup = null;
        }
        const group = new THREE.Group();

        const meshUrl = 'static/meshes/' + name + '.glb';
        const gltf = await loader.loadAsync(meshUrl);
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
            const trajResp = await fetch('static/trajs/' + name + '.json');
            if (trajResp.ok) {
                const traj = await trajResp.json();
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
                    const mat = new THREE.LineBasicMaterial({
                        color: new THREE.Color(c[0], c[1], c[2]),
                        depthTest: true,
                    });
                    group.add(new THREE.Line(geom, mat));

                    const sphereMat = new THREE.MeshBasicMaterial({ color: mat.color });
                    const sphereGeom = new THREE.SphereGeometry(0.02, 12, 12);
                    const start = new THREE.Mesh(sphereGeom, sphereMat);
                    start.position.set(agent.points[0][0], agent.points[0][1], agent.points[0][2]);
                    const end = new THREE.Mesh(sphereGeom.clone(), sphereMat);
                    const lp = agent.points[agent.points.length - 1];
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

        const box = new THREE.Box3().setFromObject(group);
        const size = new THREE.Vector3();
        box.getSize(size);
        const r = Math.max(size.x, size.y, size.z) * 0.005;
        group.traverse(o => {
            if (o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry') {
                o.scale.setScalar(r / 0.02);
            }
        });

        frameCamera(box);
        setStatus('', false);
        document.getElementById('mesh-status').style.display = 'none';
    }

    function selectThumb(thumb) {
        thumbs.forEach(t => t.style.border = '2px solid #fff');
        thumb.style.border = '3px solid #92A8D1';
        labelEl.textContent = thumb.dataset.label;
        loadScene(thumb.dataset.scene).catch(err => {
            console.error(err);
            setStatus('Failed to load scene "' + thumb.dataset.scene + '": ' + (err && err.message ? err.message : err), true);
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

    selectThumb(thumbs[0]);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
