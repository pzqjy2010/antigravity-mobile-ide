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
    let singleTapTimer = null;
    let longPressTimer = null;
    let isLongPress = false;

    overlay.addEventListener('touchstart', function (e) {
        if (e.target.id === 'imgViewerClose') return;
        // 跳过下载菜单内的元素（让它们的 click/touch 正常触发）
        if (e.target.closest && e.target.closest('#imgDownloadMenu')) return;
        e.preventDefault();
        isLongPress = false;
        if (e.touches.length === 1) {
            const now = Date.now();
            // 双击检测
            if (now - lastTap < 300) {
                clearTimeout(singleTapTimer);
                singleTapTimer = null;
                if (rotation) { rotation = 0; }
                panX = 0; panY = 0;
                fitToScreen();
                lastTap = 0;
                return;
            }
            lastTap = now;
            isDragging = true; dragMoved = false;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;

            // 长按定时器（600ms）
            clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
                if (!dragMoved) {
                    isLongPress = true;
                    _showDownloadMenu(viewImg.src);
                }
            }, 600);
        } else if (e.touches.length === 2) {
            isDragging = false;
            clearTimeout(longPressTimer);
            lastPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY);
        }
    }, { passive: false });

    overlay.addEventListener('touchmove', function (e) {
        e.preventDefault();
        clearTimeout(longPressTimer);
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

    overlay.addEventListener('touchend', function () {
        clearTimeout(longPressTimer);
        isDragging = false;
        lastPinchDist = 0;
        // 单击关闭（没拖拽、没长按 → 延迟 300ms 等双击判断）
        if (!dragMoved && !isLongPress) {
            singleTapTimer = setTimeout(() => {
                if (overlay.classList.contains('active')) closeImageViewer();
            }, 300);
        }
    });

    // 鼠标拖拽 + 长按
    let mouseLongPressTimer = null;
    let mouseIsLongPress = false;
    overlay.addEventListener('mousedown', function (e) {
        if (e.target.id === 'imgViewerClose') return;
        if (e.target.closest && e.target.closest('#imgDownloadMenu')) return;
        isDragging = true; dragMoved = false; mouseIsLongPress = false;
        lastX = e.clientX; lastY = e.clientY;
        // 鼠标长按定时器（600ms）
        clearTimeout(mouseLongPressTimer);
        mouseLongPressTimer = setTimeout(() => {
            if (!dragMoved) {
                mouseIsLongPress = true;
                isDragging = false;
                overlay.style.cursor = '';
                _showDownloadMenu(viewImg.src);
            }
        }, 600);
    });
    overlay.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        clearTimeout(mouseLongPressTimer);
        panX += e.clientX - lastX; panY += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        dragMoved = true;
        overlay.style.cursor = 'grabbing';
        updateTransform();
    });
    overlay.addEventListener('mouseup', function () {
        clearTimeout(mouseLongPressTimer);
        isDragging = false;
        overlay.style.cursor = '';
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeImageViewer();
    });
    // 鼠标点击背景关闭（排除拖拽和长按）
    overlay.addEventListener('click', function (e) {
        if ((e.target === overlay || e.target === viewImg) && !dragMoved && !mouseIsLongPress) closeImageViewer();
        mouseIsLongPress = false;
    });

    // ── 长按下载菜单 ──
    function _showDownloadMenu(src) {
        if (!src) return;
        // 移除已有的菜单
        const old = document.getElementById('imgDownloadMenu');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.id = 'imgDownloadMenu';
        menu.style.cssText = `
            position: fixed; bottom: 0; left: 0; right: 0; z-index: 10001;
            background: var(--bg-primary, #1a1a2e); border-top: 1px solid var(--border-color, #333);
            border-radius: 16px 16px 0 0; padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
            animation: slideUp 0.2s ease-out;
        `;
        menu.innerHTML = `
            <div style="width:36px;height:4px;background:rgba(255,255,255,0.3);border-radius:2px;margin:0 auto 12px"></div>
            <div id="imgDownloadBtn" style="padding:14px 20px;font-size:16px;color:#4fc3f7;text-align:center;cursor:pointer">
                💾 保存图片到本地
            </div>
            <div id="imgDownloadCancel" style="padding:14px 20px;font-size:16px;color:var(--text-dimmed,#888);text-align:center;cursor:pointer;border-top:1px solid var(--border-color,#333)">
                取消
            </div>
        `;
        overlay.appendChild(menu);

        // 用 touchend + click 双绑定确保移动端和桌面端都能触发
        const downloadHandler = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            try {
                const resp = await fetch(src);
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = src.split('/').pop().split('?')[0] || 'image.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Download failed:', err);
            }
            menu.remove();
        };
        const cancelHandler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            menu.remove();
        };
        const dlBtn = document.getElementById('imgDownloadBtn');
        const cancelBtn = document.getElementById('imgDownloadCancel');
        dlBtn.addEventListener('touchend', downloadHandler);
        dlBtn.addEventListener('click', downloadHandler);
        cancelBtn.addEventListener('touchend', cancelHandler);
        cancelBtn.addEventListener('click', cancelHandler);

        // 点击菜单外关闭
        menu.addEventListener('click', (e) => e.stopPropagation());
    }
}
