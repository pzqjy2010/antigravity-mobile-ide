// --- 截图查看器 ---
import { state, BASE_URL, cacheGet, cacheSet } from './state.js';

let _currentScreenMode = 'full';
let _monitorCountCache = 0;
let _screenshotLoading = false; // 防抖锁：加载中不允许重复触发

function _renderSegments() {
    const seg = document.getElementById('screenSegments');
    if (!seg) return;
    const c = _currentScreenMode;
    let html = `
        <button class="segment-btn ${c === 'window' ? 'active' : ''}" onclick="showScreenshot('window')" title="精确截取当前活跃项目窗口">🪟 窗口</button>
        <button class="segment-btn ${c === 'full' ? 'active' : ''}" onclick="showScreenshot('full')" title="截取并最大化项目所在物理屏">🖥️ 全屏</button>
        <div class="segment-divider"></div>
        <button class="segment-btn ${c === 'all' ? 'active' : ''}" onclick="showScreenshot('all')" title="截取所有显示器全景">🌐 全图</button>
    `;
    const mCount = _monitorCountCache;
    for (let i = 0; i < mCount; i++) {
        const modeStr = 'screen_' + i;
        html += `<button class="segment-btn ${c === modeStr ? 'active' : ''}" onclick="showScreenshot('${modeStr}')">🖥️ 屏${i + 1}</button>`;
    }
    seg.innerHTML = html;
}

export async function focusSpecificWindow(hwnd, btnNode) {
    try {
        btnNode.innerText = '...';
        await fetch(`${BASE_URL}/v1/system/windows/${hwnd}/focus`, { method: 'POST' });
        btnNode.innerText = '已置顶';
        btnNode.style.background = 'rgba(16,185,129,0.3)';
        btnNode.style.color = '#34d399';
        setTimeout(() => {
            btnNode.innerText = '置顶';
            btnNode.style.background = '';
            btnNode.style.color = '';
        }, 2000);
    } catch (e) {
        btnNode.innerText = '失败';
    }
}

function _openScreenModal() {
    const modal = document.getElementById('modal-viewer');
    if (modal.classList.contains('open')) return false; // 已打开
    modal.classList.add('open');
    modal.innerHTML = `
        <div class="screen-area">
            <div class="glass-pill screen-close-pill" onclick="closeModal()">✕</div>
            <div class="screen-img-box" id="screenImgBox">
                <div id="screenSpinner" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); display:flex; flex-direction:column; align-items:center; gap:12px; color:rgba(255,255,255,0.7); font-size:14px; pointer-events:none;">
                    <div class="viewer-spinner"></div>
                    <div>正在获取屏幕截图...</div>
                </div>
                <img id="screenImg" class="screen-img" onclick="openImageViewer(this.src)" style="display:none;" />
            </div>
            <div class="screen-controls">
                <div class="glass-pill screen-segments" id="screenSegments"></div>
                <button class="glass-pill segment-btn screen-refresh-btn" onclick="showScreenshot()">🔄</button>
            </div>
        </div>
        <div class="dash-panel">
            <div class="dash-stats" id="dashStats">
                <div class="stat-card text-dimmed">CPU: 加载中...</div>
                <div class="stat-card text-dimmed">MEM: 加载中...</div>
            </div>
            <h4 class="section-heading">活跃窗口大纲 (Active Windows)</h4>
            <div class="window-list" id="dashWindows">
                <div class="text-dimmed text-sm" style="padding:12px;">正在获取桌面可视窗口指纹...</div>
            </div>
        </div>
    `;
    return true; // 首次打开
}

export async function showScreenshot(modeOverride = null) {
    // 防抖：加载中不允许重复触发
    if (_screenshotLoading) return;
    _screenshotLoading = true;

    if (modeOverride) _currentScreenMode = modeOverride;

    const modal = document.getElementById('modal-viewer');
    const wasAlreadyOpen = modal.classList.contains('open');
    const isFirstOpen = _openScreenModal(); // 立刻打开 modal（如果还没开）

    if (isFirstOpen && !modeOverride) {
        // 首次打开：后台查询窗口状态以自动选择模式
        try {
            const res = await fetch(`${BASE_URL}/v1/system/windows?title=Antigravity&process=Antigravity.exe`);
            const data = await res.json();
            const activeWin = (data.windows || []).find(w => {
                const inst = state.instances.find(i => i.port === state.activePort);
                return inst && w.title.includes(inst.display_name || inst.workspace);
            }) || (data.windows || [])[0];
            if (activeWin) {
                _currentScreenMode = activeWin.is_maximized ? 'full' : 'window';
            }
        } catch (e) { /* 查询失败保持默认 full */ }
    } else if (wasAlreadyOpen) {
        // 刷新：显示 loading 状态
        const img = document.getElementById('screenImg');
        if (img) {
            img.classList.add('loading');
            img.style.display = 'none';
        }
        const spin = document.getElementById('screenSpinner');
        if (spin) spin.style.display = 'flex';
    }

    _renderSegments();

    const inst = state.instances.find(i => i.port === state.activePort);
    const title = (inst && inst.display_name) ? inst.display_name : 'Antigravity';

    let url = `${BASE_URL}/v1/system/screenshot?mode=${_currentScreenMode}`;
    if (_currentScreenMode === 'window' || _currentScreenMode === 'full') url += `&title=${encodeURIComponent(title)}`;

    // 所有请求并行发出，全部完成后解锁
    const p1 = fetch(url).then(r => r.json()).then(data => {
        const img = document.getElementById('screenImg');
        const spin = document.getElementById('screenSpinner');
        if (!img) return;
        img.src = `data:image/jpeg;base64,${data.image}`;
        img.style.display = 'block';
        img.classList.remove('loading');
        if (spin) spin.style.display = 'none';
    }).catch(e => {
        const imgBox = document.getElementById('screenImgBox');
        if (imgBox) imgBox.innerHTML = `<div class="text-danger">截图失败: ${e.message}</div>`;
    });

    // SWR: 先显示缓存，再后台刷新
    const cachedInfo = cacheGet('sys_info');
    if (cachedInfo) _applySysInfo(cachedInfo.data);
    const p2 = fetch(`${BASE_URL}/v1/system/info`).then(r => r.json()).then(data => {
        cacheSet('sys_info', data);
        _applySysInfo(data);
    }).catch(e => { });

    const cachedWins = cacheGet('sys_windows');
    if (cachedWins) _applyWindows(cachedWins.data);
    const p3 = fetch(`${BASE_URL}/v1/system/windows`).then(r => r.json()).then(data => {
        cacheSet('sys_windows', data);
        _applyWindows(data);
    }).catch(e => { });

    // 全部完成后解锁
    await Promise.allSettled([p1, p2, p3]);
    _screenshotLoading = false;
}

function _applySysInfo(data) {
    const cpuColor = data.cpu.percent > 80 ? 'var(--danger)' : data.cpu.percent > 60 ? 'var(--warning)' : 'var(--success)';
    const memColor = data.memory.percent > 80 ? 'var(--danger)' : data.memory.percent > 60 ? 'var(--warning)' : 'var(--success)';
    const dashStats = document.getElementById('dashStats');
    if (dashStats) {
        dashStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">CPU 核心负载</div>
                <div class="stat-value" style="color:${cpuColor};">${data.cpu.percent}%</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">内存空间占用</div>
                <div class="stat-value" style="color:${memColor};">${data.memory.percent}%</div>
            </div>
        `;
    }
    if (data.display && data.display.count > 0) {
        _monitorCountCache = data.display.count;
        _renderSegments();
    }
}

function _applyWindows(data) {
    const dashWindows = document.getElementById('dashWindows');
    if (!dashWindows || !data.windows) return;
    let wHtml = '';
    const validWindows = data.windows.filter(w => w.title && !w.is_minimized);
    validWindows.slice(0, 50).forEach(w => {
        wHtml += `
            <div class="window-card">
                <span class="window-title">🪟 ${w.title}</span>
                <button class="pin-btn" onclick="focusSpecificWindow(${w.hwnd}, this)">置顶</button>
            </div>
        `;
    });
    dashWindows.innerHTML = wHtml || '<div class="text-muted">无活跃窗口</div>';
}
