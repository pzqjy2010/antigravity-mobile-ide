// ===== 图片全屏查看器（支持双指缩放 + 拖拽平移 + 双击复位 + 智能旋转）=====
export function initImageViewer() {
    const overlay = document.getElementById('imgViewerOverlay');
    const viewImg = document.getElementById('imgViewerImg');
    const infoLabel = document.getElementById('imgViewerInfo');

    let scale = 1, panX = 0, panY = 0, rotation = 0;
    let imgW = 0, imgH = 0;
    let isDragging = false, dragMoved = false, lastX = 0, lastY = 0;
    let lastPinchDist = 0, lastTap = 0;

    function updateTransform() {
        viewImg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale}) rotate(${rotation}deg)`;
        infoLabel.textContent = `${imgW} \u00d7 ${imgH}  |  ${Math.round(scale * 100)}%${rotation ? '  \u21bb' : ''}`;
    }

    function fitToScreen() {
        const vw = window.innerWidth, vh = window.innerHeight;
        const isLandscapeImg = imgW > imgH;
        const isPortraitView = vh > vw;
        panX = 0; panY = 0;

        if (isLandscapeImg && isPortraitView && imgW / imgH > 1.2) {
            rotation = 90;
            scale = Math.min(vw / imgH, vh / imgW, 1);
        } else {
            rotation = 0;
            scale = Math.min(vw / imgW, vh / imgH, 1);
        }
        viewImg.style.width = imgW + 'px';
        viewImg.style.height = imgH + 'px';
        updateTransform();
    }

    window.openImageViewer = function (src) {
        if (!src) return;
        overlay.classList.add('active');
        viewImg.onload = function () {
            imgW = viewImg.naturalWidth;
            imgH = viewImg.naturalHeight;
            fitToScreen();
        };
        viewImg.src = src;
        document.body.style.overflow = 'hidden';
    };

    window.closeImageViewer = function () {
        overlay.classList.remove('active');
        viewImg.src = '';
        rotation = 0; panX = 0; panY = 0; scale = 1;
        document.body.style.overflow = '';
    };

    // 滚轮缩放
    overlay.addEventListener('wheel', function (e) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        scale = Math.max(0.05, Math.min(scale * factor, 30));
        updateTransform();
    }, { passive: false });

    // 触摸事件
    overlay.addEventListener('touchstart', function (e) {
        if (e.target.id === 'imgViewerClose') return;
        e.preventDefault();
        if (e.touches.length === 1) {
            const now = Date.now();
            if (now - lastTap < 300) {
                if (rotation) { rotation = 0; }
                panX = 0; panY = 0;
                fitToScreen();
                lastTap = 0; return;
            }
            lastTap = now;
            isDragging = true; dragMoved = false;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            isDragging = false;
            lastPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY);
        }
    }, { passive: false });

    overlay.addEventListener('touchmove', function (e) {
        e.preventDefault();
        if (e.touches.length === 1 && isDragging) {
            panX += e.touches[0].clientX - lastX;
            panY += e.touches[0].clientY - lastY;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
            dragMoved = true;
            updateTransform();
        } else if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY);
            if (lastPinchDist > 0) {
                scale = Math.max(0.05, Math.min(scale * (dist / lastPinchDist), 30));
                updateTransform();
            }
            lastPinchDist = dist;
        }
    }, { passive: false });

    overlay.addEventListener('touchend', function () { isDragging = false; lastPinchDist = 0; });

    // 鼠标拖拽
    overlay.addEventListener('mousedown', function (e) {
        if (e.target.id === 'imgViewerClose') return;
        isDragging = true; dragMoved = false;
        lastX = e.clientX; lastY = e.clientY;
        overlay.style.cursor = 'grabbing';
    });
    overlay.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        panX += e.clientX - lastX; panY += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        dragMoved = true;
        updateTransform();
    });
    overlay.addEventListener('mouseup', function () { isDragging = false; overlay.style.cursor = ''; });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeImageViewer();
    });
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay && !dragMoved) closeImageViewer();
    });
}
