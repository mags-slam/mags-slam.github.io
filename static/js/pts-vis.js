document.addEventListener('DOMContentLoaded', () => {
    const scenes = [
        { name: 'replica_apart0',      label: 'ReplicaMultiAgent Apart 0',      thumb: 'static/thumbs/replica_apart0.jpg',      video: 'static/video/replica_apart0.mp4' },
        { name: 'replica_apart1',      label: 'ReplicaMultiAgent Apart 1',      thumb: 'static/thumbs/replica_apart1.jpg',      video: 'static/video/replica_apart1.mp4' },
        { name: 'replica_apart2',      label: 'ReplicaMultiAgent Apart 2',      thumb: 'static/thumbs/replica_apart2.jpg',      video: 'static/video/replica_apart2.mp4' },
        { name: 'replica_office0',     label: 'ReplicaMultiAgent Office 0',     thumb: 'static/thumbs/replica_office0.jpg',     video: 'static/video/replica_office0.mp4' },
        { name: 'replica_plus_apart0', label: 'ReplicaMultiAgent Plus Apart 0', thumb: 'static/thumbs/replica_plus_apart0.png', video: 'static/video/replica_plus_apart0.mp4' },
        { name: 'replica_plus_room0',  label: 'ReplicaMultiAgent Plus Room 0',  thumb: 'static/thumbs/replica_plus_room0.png',  video: 'static/video/replica_plus_room0.mp4' },
    ];

    const thumbnailsHtml = scenes.map(s => `
        <img src="${s.thumb}"
             data-video="${s.video}"
             data-label="${s.label}"
             class="thumbnail pts-thumbnail"
             alt="${s.name}"
             title="${s.label}"
             style="cursor: pointer; width: 100px;">
    `).join('');

    const content = `
        <div class="container" style="max-width: 95%; width: 95%;">
            <div class="columns is-centered has-text-centered">
                <div class="column is-full panel-style">
                    <div class="video-container" style="width: 100%; max-width: none;">
                        <div class="video-display-container" style="display: flex; justify-content: center; width: 100%;">
                            <div id="video-container" style="width: 95%; position: relative; background-color: white; aspect-ratio: 16/9;">
                                <video id="main-video" controls autoplay muted loop playsinline disablePictureInPicture style="width: 100%; height: 100%; object-fit: contain; background-color: white;">
                                    <source id="main-video-source" type="video/mp4">
                                </video>
                                <div id="video-placeholder" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: white; display: none; align-items: center; justify-content: center; color: #666; font-size: 16px;">
                                    Loading...
                                </div>
                            </div>
                        </div>
                        <div id="current-scene-label" style="text-align: center; font-size: 1.1rem; font-weight: 600; margin-top: 12px; color: #363636;"></div>
                    </div>
                    <div class="thumbnail-container">
                        ${thumbnailsHtml}
                    </div>
                </div>
            </div>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        .thumbnail {
            border-radius: 6px;
            border: 2px solid #fff;
            box-shadow: 0 0 4px #888;
            width: 100px;
            height: 70px;
            object-fit: cover;
            transition: transform 0.3s ease;
        }
        .thumbnail:hover { transform: scale(1.1); }
        .video-label {
            font-size: 1.3rem;
            font-weight: bold;
            margin: 0 20px;
        }
    `;
    document.head.appendChild(style);

    const section = document.getElementById('pts-vis');
    section.innerHTML = content;
    section.style.display = 'block';

    const mainVideoElement = document.getElementById('main-video');
    const mainVideoSource = document.getElementById('main-video-source');
    const sceneLabel = document.getElementById('current-scene-label');
    const thumbnails = document.querySelectorAll('.pts-thumbnail');

    mainVideoElement.loop = true;

    thumbnails[0].style.border = '3px solid #92A8D1';
    mainVideoSource.src = thumbnails[0].dataset.video;
    sceneLabel.textContent = thumbnails[0].dataset.label;
    mainVideoElement.load();

    thumbnails.forEach(thumbnail => {
        thumbnail.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (thumbnail.style.border.includes('3px solid')) {
                return;
            }

            thumbnails.forEach(t => t.style.border = '2px solid #fff');
            thumbnail.style.border = '3px solid #92A8D1';

            const videoPlaceholder = document.getElementById('video-placeholder');
            videoPlaceholder.style.display = 'flex';

            mainVideoElement.pause();
            mainVideoElement.style.opacity = '0';

            mainVideoSource.src = thumbnail.dataset.video;
            sceneLabel.textContent = thumbnail.dataset.label;
            mainVideoElement.load();

            Promise.all([
                new Promise(resolve => mainVideoElement.addEventListener('loadeddata', resolve, { once: true })),
                new Promise(resolve => mainVideoElement.addEventListener('canplay', resolve, { once: true }))
            ]).then(() => {
                setTimeout(() => {
                    videoPlaceholder.style.display = 'none';
                    mainVideoElement.style.opacity = '1';
                }, 50);

                mainVideoElement.loop = true;
                mainVideoElement.play().catch(() => {});
            }).catch(error => {
                console.warn('Error loading video:', error);
                videoPlaceholder.style.display = 'none';
            });
        });
    });
});
