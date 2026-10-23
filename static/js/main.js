// main.js
// Page behaviour: video galleries, the two 3D viewers, table tabs, BibTeX copy
// and the active section in the navigation bar.

const RESULT_VIDEOS = [
    { label: 'Apartment 0', group: 'ReplicaMultiAgent', thumb: 'replica_apart0.jpg', video: 'replica_apart0.mp4' },
    { label: 'Apartment 1', group: 'ReplicaMultiAgent', thumb: 'replica_apart1.jpg', video: 'replica_apart1.mp4' },
    { label: 'Apartment 2', group: 'ReplicaMultiAgent', thumb: 'replica_apart2.jpg', video: 'replica_apart2.mp4' },
    { label: 'Office 0', group: 'ReplicaMultiAgent', thumb: 'replica_office0.jpg', video: 'replica_office0.mp4' },
    { label: 'Apartment 0', group: 'ReplicaMultiAgent Plus', thumb: 'replica_plus_apart0.png', video: 'replica_plus_apart0.mp4' },
    { label: 'Room 0', group: 'ReplicaMultiAgent Plus', thumb: 'replica_plus_room0.png', video: 'replica_plus_room0.mp4' },
];

const DATASET_VIDEOS = [
    { label: 'Apartment 0', thumb: 'replica_plus_apart0_dataset.jpg', video: 'replica_plus_apart0_dataset.mp4' },
    { label: 'Apartment 2', thumb: 'replica_plus_apart2_dataset.jpg', video: 'replica_plus_apart2_dataset.mp4' },
    { label: 'Hotel 0', thumb: 'replica_plus_hotel0_dataset.jpg', video: 'replica_plus_hotel0_dataset.mp4' },
    { label: 'Office 2', thumb: 'replica_plus_office2_dataset.jpg', video: 'replica_plus_office2_dataset.mp4' },
];

const SCENES = [
    { name: 'replica_apart0', label: 'Apartment 0', group: 'ReplicaMultiAgent', thumb: 'replica_apart0.jpg' },
    { name: 'replica_office0', label: 'Office 0', group: 'ReplicaMultiAgent', thumb: 'replica_office0.jpg' },
    { name: 'replica_plus_room0', label: 'Room 0', group: 'ReplicaMultiAgent Plus', thumb: 'replica_plus_room0.png' },
    { name: 'replica_plus_office2', label: 'Office 2', group: 'ReplicaMultiAgent Plus', thumb: 'replica_plus_office2.png' },
    { name: 'eth3d_planar', label: 'Planar', group: 'ETH3D', thumb: 'eth3d_planar.png' },
    { name: 'eth3d_plant_scene', label: 'Plant Scene', group: 'ETH3D', thumb: 'eth3d_plant_scene.png' },
    { name: 'tnt_truck', label: 'Truck', group: 'Tanks and Temples', thumb: 'tnt_truck.jpg' },
    { name: 'tnt_ignatius', label: 'Ignatius', group: 'Tanks and Temples', thumb: 'tnt_ignatius.jpg' },
];

const COVERAGE = { fused: '7scenes_file_all', agents: ['7scenes_file_agent1', '7scenes_file_agent2', '7scenes_file_agent3', '7scenes_file_agent4'] };

// Picker of thumbnail buttons, grouped under small dataset headings.
function buildPicker(root, items, onPick) {
    const groups = [];
    for (const it of items) {
        let g = groups.find(x => x.name === (it.group || ''));
        if (!g) groups.push(g = { name: it.group || '', items: [] });
        g.items.push(it);
    }
    root.innerHTML = groups.map(g => `
        <div class="picker-group">
            ${g.name ? `<div class="picker-title">${g.name}</div>` : ''}
            <div class="picker-row">
                ${g.items.map(it => `
                    <button type="button" class="thumb" data-i="${items.indexOf(it)}">
                        <img src="static/thumbs/${it.thumb}" alt="" loading="lazy">
                        <span>${it.label}</span>
                    </button>`).join('')}
            </div>
        </div>`).join('');
    const buttons = [...root.querySelectorAll('.thumb')];
    const select = i => {
        buttons.forEach(b => b.classList.toggle('is-on', +b.dataset.i === i));
        onPick(items[i], i);
    };
    buttons.forEach(b => b.addEventListener('click', () => {
        if (!b.classList.contains('is-on')) select(+b.dataset.i);
    }));
    return select;
}

function whenNear(el, fn) {
    const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: '400px 0px' });
    io.observe(el);
}

function initGallery(root, items) {
    const video = root.querySelector('video');
    const select = buildPicker(root.querySelector('.picker'), items, it => {
        video.src = 'static/video/' + it.video;
        video.play().catch(() => {});
    });
    whenNear(root, () => select(0));
}

function segmented(root, onChange) {
    const buttons = [...root.querySelectorAll('button')];
    buttons.forEach(b => b.addEventListener('click', () => {
        buttons.forEach(x => x.classList.toggle('is-on', x === b));
        onChange(b.dataset.value);
    }));
}

function failViewer(card, err) {
    console.error(err);
    card.classList.add('has-error');
    card.querySelector('.viewer-error').textContent =
        location.protocol === 'file:'
            ? 'The 3D viewer needs the page to be served over HTTP.'
            : 'The 3D viewer could not be loaded. Please check your connection and reload the page.';
}

function wireCommon(card, viewer) {
    segmented(card.querySelector('[data-role="shading"]'), v => viewer.setShading(v));
    card.querySelector('[data-role="reset"]').addEventListener('click', () => viewer.goHome(true));
    card.querySelector('[data-role="full"]').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (card.requestFullscreen) card.requestFullscreen();
    });
}

async function initSceneViewer(mod) {
    const card = document.getElementById('scene-card');
    const viewer = new mod.Viewer(card.querySelector('.viewer'));
    wireCommon(card, viewer);

    const trajBtn = card.querySelector('[data-role="traj"]');
    trajBtn.addEventListener('click', () => {
        const on = !trajBtn.classList.contains('is-on');
        trajBtn.classList.toggle('is-on', on);
        trajBtn.setAttribute('aria-pressed', on);
        viewer.setTrajectories(on);
    });

    // Trajectory replay: the play button animates the scrubber over 9 seconds.
    const scrub = card.querySelector('[data-role="scrub"]');
    const play = card.querySelector('[data-role="play"]');
    let playing = null;
    const setPlaying = on => {
        playing = on ? { t0: performance.now(), from: scrub.value >= 1000 ? 0 : +scrub.value } : null;
        play.classList.toggle('is-on', on);
        if (on && !trajBtn.classList.contains('is-on')) trajBtn.click();
    };
    play.addEventListener('click', () => setPlaying(!playing));
    scrub.addEventListener('input', () => { setPlaying(false); viewer.setReplay(scrub.value / 1000); });
    viewer.onFrame = now => {
        if (!playing) return;
        const v = Math.min(1000, playing.from + (now - playing.t0) / 9);
        scrub.value = v;
        viewer.setReplay(v / 1000);
        if (v >= 1000) setPlaying(false);
    };

    const cache = new Map();
    let token = 0;
    const select = buildPicker(document.getElementById('scene-picker'), SCENES, async scene => {
        const my = ++token;
        try {
            let layer = cache.get(scene.name);
            if (!layer) {
                viewer.setProgress(0);
                layer = await viewer.loadLayer(scene.name);
                cache.set(scene.name, layer);
            }
            if (my !== token) return;
            viewer.align(layer.up);
            viewer.show([layer]);
            viewer.setLegend(layer.tracks.map((t, i) => ({ color: t.color, label: `Agent ${i + 1}` })));
            viewer.frame(layer);
        } catch (err) {
            failViewer(card, err);
        }
    });
    select(0);
}

async function initCoverageViewer(mod) {
    const card = document.getElementById('coverage-card');
    const viewer = new mod.Viewer(card.querySelector('.viewer'));
    wireCommon(card, viewer);

    const seg = card.querySelector('[data-role="layer"]');
    seg.innerHTML = ['Fused map', 'Agent 1', 'Agent 2', 'Agent 3', 'Agent 4'].map((label, i) =>
        `<button type="button" data-value="${i - 1}" ${i === 0 ? 'class="is-on"' : ''} disabled>` +
        (i ? `<i style="background:${mod.AGENT_COLORS[i - 1]}"></i>` : '') + `${label}</button>`).join('');

    try {
        viewer.setProgress(0);
        const fused = await viewer.loadLayer(COVERAGE.fused);
        viewer.align(fused.up);
        viewer.show([fused]);
        viewer.frame(fused);
        viewer.setLegend(fused.tracks.map((t, i) => ({ color: t.color, label: `Agent ${i + 1}` })));
        seg.querySelector('[data-value="-1"]').disabled = false;

        const ghost = { ...fused, ghost: true, group: fused.group.clone(false) };
        ghost.mesh = new (fused.mesh.constructor)(fused.geom, fused.ghostMat);
        ghost.tracks = [];
        ghost.group.add(ghost.mesh);

        const agents = [];
        for (let k = 0; k < COVERAGE.agents.length; k++) {
            agents.push(await viewer.loadLayer(COVERAGE.agents[k], { alignFrom: false, agentOffset: k }));
            seg.querySelector(`[data-value="${k}"]`).disabled = false;
        }

        segmented(seg, v => {
            const k = +v;
            if (k < 0) {
                viewer.show([fused]);
                viewer.setLegend(fused.tracks.map((t, i) => ({ color: t.color, label: `Agent ${i + 1}` })));
            } else {
                viewer.show([agents[k], ghost]);
                viewer.setLegend([
                    { color: mod.AGENT_COLORS[k], label: `Agent ${k + 1}` },
                    { color: '#b9c0c9', label: 'Fused map' },
                ]);
            }
        });
    } catch (err) {
        failViewer(card, err);
    }
}

function initViewers() {
    const scene = document.getElementById('scene-card');
    const coverage = document.getElementById('coverage-card');
    let modPromise = null;
    const load = () => modPromise || (modPromise = import('./viewer.js?v=12'));
    whenNear(scene, () => load().then(initSceneViewer).catch(err => failViewer(scene, err)));
    whenNear(coverage, () => load().then(initCoverageViewer).catch(err => failViewer(coverage, err)));
}

function initTables() {
    const tabs = document.querySelector('[data-role="table-tabs"]');
    const figures = [...document.querySelectorAll('[data-table]')];
    segmented(tabs, v => figures.forEach(f => { f.hidden = f.dataset.table !== v; }));
}

function initCopy() {
    const btn = document.querySelector('[data-role="copy"]');
    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(btn.parentElement.querySelector('code').textContent);
            btn.textContent = 'Copied';
        } catch (e) {
            btn.textContent = 'Press Ctrl+C';
        }
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    });
}

function initNav() {
    const links = [...document.querySelectorAll('.nav-links a')];
    const sections = links.map(a => document.querySelector(a.getAttribute('href')));
    const io = new IntersectionObserver(() => {
        const y = window.innerHeight * 0.3;
        let current = null;
        for (const s of sections) if (s.getBoundingClientRect().top <= y) current = s;
        links.forEach((a, i) => a.classList.toggle('is-on', sections[i] === current));
    }, { threshold: [0, 0.25, 0.5, 1] });
    sections.forEach(s => io.observe(s));
}

initGallery(document.querySelector('[data-gallery="results"]'), RESULT_VIDEOS);
initGallery(document.querySelector('[data-gallery="dataset"]'), DATASET_VIDEOS);
initViewers();
initTables();
initCopy();
initNav();
