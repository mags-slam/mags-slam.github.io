document.addEventListener('DOMContentLoaded', () => {
    const scenes = [
        { name: 'replica_plus_apart0_dataset',  label: 'Apart 0',  thumb: 'static/thumbs/replica_plus_apart0_dataset.jpg',  video: 'static/video/replica_plus_apart0_dataset.mp4' },
        { name: 'replica_plus_apart2_dataset',  label: 'Apart 2',  thumb: 'static/thumbs/replica_plus_apart2_dataset.jpg',  video: 'static/video/replica_plus_apart2_dataset.mp4' },
        { name: 'replica_plus_hotel0_dataset',  label: 'Hotel 0',  thumb: 'static/thumbs/replica_plus_hotel0_dataset.jpg',  video: 'static/video/replica_plus_hotel0_dataset.mp4' },
        { name: 'replica_plus_office2_dataset', label: 'Office 2', thumb: 'static/thumbs/replica_plus_office2_dataset.jpg', video: 'static/video/replica_plus_office2_dataset.mp4' },
    ];

    const section = document.getElementById('dataset-vis');
    if (!section) return;

    const thumbnailsHtml = scenes.map(s => `
        <img src="${s.thumb}"
             data-video="${s.video}"
             data-label="${s.label}"
             class="thumbnail dataset-thumbnail"
             alt="${s.name}"
             title="${s.label}"
             style="cursor: pointer; width: 100px;">
    `).join('');

    section.innerHTML = `
        <div class="container" style="max-width: 95%; width: 95%;">
            <div class="columns is-centered has-text-centered">
                <div class="column is-full panel-style">
                    <div class="video-container" style="width: 100%; max-width: none;">
                        <div style="display: flex; justify-content: center; width: 100%;">
                            <div id="dataset-video-container" style="width: 95%; position: relative; background-color: white; aspect-ratio: 16/9;">
                                <video id="dataset-main-video" controls autoplay muted loop playsinline disablePictureInPicture style="width: 100%; height: 100%; object-fit: contain; background-color: white;">
                                    <source id="dataset-main-video-source" type="video/mp4">
                                </video>
                                <div id="dataset-video-placeholder" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: white; display: none; align-items: center; justify-content: center; color: #666; font-size: 16px;">
                                    Loading...
                                </div>
                            </div>
                        </div>
                        <div id="dataset-scene-label" style="text-align: center; font-size: 1.1rem; font-weight: 600; margin-top: 12px; color: #363636;"></div>
                    </div>
                    <div class="thumbnail-container">
                        ${thumbnailsHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
    section.style.display = 'block';

    const mainVideo = document.getElementById('dataset-main-video');
    const mainSource = document.getElementById('dataset-main-video-source');
    const sceneLabel = document.getElementById('dataset-scene-label');
    const thumbnails = document.querySelectorAll('.dataset-thumbnail');

    mainVideo.loop = true;

    thumbnails[0].style.border = '3px solid #92A8D1';
    mainSource.src = thumbnails[0].dataset.video;
    sceneLabel.textContent = thumbnails[0].dataset.label;
    mainVideo.load();

    thumbnails.forEach(thumbnail => {
        thumbnail.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (thumbnail.style.border.includes('3px solid')) return;

            thumbnails.forEach(t => t.style.border = '2px solid #fff');
            thumbnail.style.border = '3px solid #92A8D1';

            const placeholder = document.getElementById('dataset-video-placeholder');
            placeholder.style.display = 'flex';

            mainVideo.pause();
            mainVideo.style.opacity = '0';

            mainSource.src = thumbnail.dataset.video;
            sceneLabel.textContent = thumbnail.dataset.label;
            mainVideo.load();

            Promise.all([
                new Promise(resolve => mainVideo.addEventListener('loadeddata', resolve, { once: true })),
                new Promise(resolve => mainVideo.addEventListener('canplay', resolve, { once: true }))
            ]).then(() => {
                setTimeout(() => {
                    placeholder.style.display = 'none';
                    mainVideo.style.opacity = '1';
                }, 50);
                mainVideo.loop = true;
                mainVideo.play().catch(() => {});
            }).catch(error => {
                console.warn('Error loading video:', error);
                placeholder.style.display = 'none';
            });
        });
    });
});
