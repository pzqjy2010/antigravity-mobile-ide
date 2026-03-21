// --- 设置面板 ---
import { state, BASE_URL, cacheGet, cacheSet } from './state.js';
import { fetchInstances } from './instances.js';

export async function renderSettings() {
    const c = document.getElementById('settingsContent');
    const name = state.userName || '...';
    const plan = state.userPlan || '...';
    c.innerHTML = `
        <div class="settings-section">
            <h3>👤 用户信息</h3>
            <div class="settings-row"><span class="label">用户名</span><span>${name}</span></div>
            <div class="settings-row"><span class="label">套餐</span><span class="text-primary-bold">${plan}</span></div>
        </div>
        <div class="settings-section" id="sysInfoSection">
            <h3>🖥️ 主机负载探针</h3>
            <div class="text-muted text-sm">加载中...</div>
        </div>
        <div class="settings-section" id="settingsQuotaSection">
            <h3>📊 配额</h3>
            <div class="text-muted text-sm">加载中...</div>
        </div>
        <div class="settings-section">
            <h3>🔄 实例管理</h3>
            <button class="settings-btn" onclick="refreshInstances()">刷新 LS 实例列表</button>
        </div>
        <div class="settings-section">
            <h3>📂 打开新工作区</h3>
            <div class="settings-inline">
                <input type="text" id="newWsPath" placeholder="C:\\Projects\\xxx" class="settings-input">
                <button class="settings-btn" style="width:auto; padding:8px 16px;" onclick="openNewWorkspace()">🚀</button>
            </div>
        </div>
        <div class="settings-section" id="autoScrollSection">
            <h3>🛡️ 智能滚动守护 (B+C 策略)</h3>
            <div class="text-muted text-sm">加载中...</div>
        </div>
        <div class="settings-section" id="windowsSection">
            <h3>🪟 工作区窗口管理</h3>
            <div class="text-muted text-sm">加载中...</div>
        </div>
        <div class="settings-section" style="padding: 0;">
            <details class="danger-zone" id="dangerZoneDetails">
                <summary>🚦 危险操作区 (进程与会话)</summary>
                <div class="danger-zone-content">
                    <div class="text-muted text-sm" style="margin-bottom: 8px;">立刻终止并关闭当前工作区正在执行的 AI 任务：</div>
                    <button class="settings-btn danger" id="cancelBtn" style="font-size:14px; padding:10px;" onclick="cancelCascade()">🛑 紧急停止当前 AI 会话</button>
                    <div id="cancelResult" class="text-muted text-sm mt-8"></div>
                </div>
                <div style="padding: 0 4px 16px;">
                    <h4 class="section-heading" style="margin-top:12px;">🚦 主进程列表</h4>
                    <div id="processContent" class="text-muted text-sm">展开后自动加载...</div>
                </div>
            </details>
        </div>
    `;
    const cachedQuota = cacheGet('settings_quota_' + state.activePort);
    if (cachedQuota) _renderQuota(cachedQuota.data);

    try {
        const res = await fetch(`${BASE_URL}/v1/ls/user-status?port=${state.activePort}`);
        if (res.status === 503) {
            document.getElementById('settingsQuotaSection').innerHTML = '<h3>📊 配额</h3><div class="text-muted text-sm">⚠️ LS 未连接，请先确认 IDE 已打开</div>';
            return;
        }
        const data = await res.json();
        cacheSet('settings_quota_' + state.activePort, data);
        _renderQuota(data);
    } catch (e) {
        console.error('Quota load error:', e);
        if (!cachedQuota) {
            const section = document.getElementById('settingsQuotaSection');
            if (section) section.innerHTML = '<h3>📊 配额</h3><div class="text-muted text-sm">⚠️ 加载失败</div>';
        }
    }

    setTimeout(() => {
        fetchSystemInfo();
        fetchAutoScroll();
        fetchWindows();
    }, 100);

    // 展开危险操作区时自动加载进程列表
    const dangerDetails = document.getElementById('dangerZoneDetails');
    if (dangerDetails) {
        dangerDetails.addEventListener('toggle', () => {
            if (dangerDetails.open) fetchProcesses();
        });
    }
}

function _renderQuota(data) {
    const section = document.getElementById('settingsQuotaSection');
    if (!section) return;
    const us = data.userStatus || {};
    const ps = us.planStatus || {};
    const pi = ps.planInfo || {};
    const tier = us.userTier || {};
    let html = '<h3>📊 套餐详情</h3>';
    html += `<div class="settings-row"><span class="label">套餐等级</span><span>${tier.name || pi.planName || '?'}</span></div>`;
    if (pi.maxNumPremiumChatMessages) {
        const val = pi.maxNumPremiumChatMessages;
        html += `<div class="settings-row"><span class="label">高级对话上限</span><span>${val === '-1' ? '无限制' : val}</span></div>`;
    }
    const credits = ps.availableCredits || [];
    credits.forEach(c => {
        const type = (c.creditType || '').replace('GOOGLE_ONE_AI', 'AI 点数');
        html += `<div class="settings-row"><span class="label">${type}</span><span>${c.creditAmount || 0} (最低消耗 ${c.minimumCreditAmountForUsage || 0})</span></div>`;
    });
    if (state.modelsData && state.modelsData.length > 0) {
        html += '<div class="settings-divider"><b class="text-sm text-dimmed">模型配额</b></div>';
        state.modelsData.forEach(m => {
            if (m.quota !== undefined && m.quota !== null) {
                const pct = Math.round(m.quota * 100);
                const color = pct < 20 ? 'var(--danger)' : pct < 50 ? 'var(--warning)' : 'var(--success)';
                html += `<div class="mt-6"><div class="settings-row"><span class="label">${m.label}</span><span>${pct}% 剩余</span></div>
                    <div class="quota-bar"><div class="quota-fill" style="width:${pct}%; background:${color};"></div></div></div>`;
            } else {
                html += `<div class="mt-6"><div class="settings-row"><span class="label text-dimmed">${m.label}</span><span class="text-dimmed">-</span></div></div>`;
            }
        });
    }
    section.innerHTML = html;
}

async function fetchSystemInfo() {
    const cached = cacheGet('settings_sysinfo');
    if (cached) _renderSysInfo(cached.data);
    try {
        const res = await fetch(`${BASE_URL}/v1/system/info`);
        const data = await res.json();
        cacheSet('settings_sysinfo', data);
        _renderSysInfo(data);
    } catch (e) { }
}

function _renderSysInfo(data) {
    const section = document.getElementById('sysInfoSection');
    if (!section) return;
    const memColor = data.memory.percent > 80 ? 'var(--danger)' : data.memory.percent > 60 ? 'var(--warning)' : 'var(--success)';
    const cpuColor = data.cpu.percent > 80 ? 'var(--danger)' : data.cpu.percent > 60 ? 'var(--warning)' : 'var(--success)';

    let html = `
        <div class="settings-row"><span class="label">主机名</span><span>${data.hostname}</span></div>
        <div class="mt-8">
            <div class="settings-row"><span class="label">CPU 负载 (${data.cpu.cores} 核)</span><span>${data.cpu.percent}%</span></div>
            <div class="quota-bar"><div class="quota-fill" style="width:${data.cpu.percent}%; background:${cpuColor};"></div></div>
        </div>
        <div class="mt-8">
            <div class="settings-row"><span class="label">内存占用 (${data.memory.used_gb} / ${data.memory.total_gb} GB)</span><span>${data.memory.percent}%</span></div>
            <div class="quota-bar"><div class="quota-fill" style="width:${data.memory.percent}%; background:${memColor};"></div></div>
        </div>
        <div class="settings-row mt-8"><span class="label">主显示器</span><span>${data.display.width} × ${data.display.height}</span></div>
    `;
    section.innerHTML = `<h3>🖥️ 主机负载探针</h3>${html}`;
}

export async function refreshInstances() {
    try {
        await fetch(`${BASE_URL}/v1/instances/refresh`, { method: 'POST' });
        await fetchInstances();
        renderSettings();
    } catch (e) { alert('刷新失败: ' + e.message); }
}

export async function openNewWorkspace() {
    const path = document.getElementById('newWsPath').value.trim();
    if (!path) return;
    try {
        const res = await fetch(`${BASE_URL}/v1/system/open-workspace?path=${encodeURIComponent(path)}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) { alert('已打开: ' + path); }
        else { alert('打开失败'); }
    } catch (e) { alert('错误: ' + e.message); }
}

export async function cancelCascade(cascadeId) {
    if (!state.activePort) return;
    const btn = document.getElementById('cancelBtn');
    const resultDiv = document.getElementById('cancelResult');
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⭐ 正在停止...';
    }
    try {
        const res = await fetch(`${BASE_URL}/v1/instances/${state.activePort}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cascade_id: cascadeId || state.activeConvId || null })
        });
        const data = await res.json();
        let msg = '';
        for (const [method, r] of Object.entries(data.results || {})) {
            msg += `${method}: ${r.ok ? '✅ 成功' : '❌ ' + r.error}\n`;
        }
        if (resultDiv) resultDiv.innerText = msg;
        if (btn) {
            btn.innerText = '✅ 已停止';
            setTimeout(() => { btn.innerText = '🛑 紧急停止当前 AI 会话'; btn.disabled = false; }, 3000);
        }
    } catch (e) {
        if (resultDiv) resultDiv.innerText = '停止失败: ' + e.message;
        if (btn) { btn.innerText = '🛑 紧急停止当前 AI 会话'; btn.disabled = false; }
    }
}

async function fetchAutoScroll() {
    try {
        const res = await fetch(`${BASE_URL}/v1/system/auto-scroll`);
        const data = await res.json();
        let activeCount = 0;
        for (const ws in data.workspace_status) { if (data.workspace_status[ws].active) activeCount++; }

        const html = `
             <div class="settings-row">
                <span class="label">守护状态 <span class="status-badge ${data.enabled ? 'on' : 'off'}">${data.enabled ? 'ON' : 'OFF'}</span></span>
                <button class="settings-btn settings-btn-sm"
                        onclick="toggleAutoScroll(${!data.enabled})">${data.enabled ? '关闭' : '开启'}</button>
            </div>
            <div class="settings-row mt-8">
                <span class="label">统计信息</span>
                <span class="text-muted text-sm">活跃会话: ${activeCount} | 累计重绘: ${data.scroll_count || 0}次</span>
            </div>
        `;
        document.getElementById('autoScrollSection').innerHTML = '<h3>🛡️ 智能滚动守护 (B+C 策略)</h3>' + html;
    } catch (e) { }
}

export async function toggleAutoScroll(enabled) {
    try {
        await fetch(`${BASE_URL}/v1/system/auto-scroll`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        fetchAutoScroll();
    } catch (e) { }
}

async function fetchWindows() {
    const cached = cacheGet('settings_windows');
    if (cached) _renderWindows(cached.data);
    try {
        const res = await fetch(`${BASE_URL}/v1/system/windows?title=Antigravity&process=Antigravity.exe`);
        const data = await res.json();
        cacheSet('settings_windows', data);
        _renderWindows(data);
    } catch (e) { }
}

function _renderWindows(data) {
    const wSec = document.getElementById('windowsSection');
    if (!wSec) return;
    let html = '';
    (data.windows || []).forEach(w => {
        const wsName = w.title.split(' - ')[0] || '?';
        const isMin = w.is_minimized ? '[MIN]' : '';
        html += `
            <div class="settings-item">
                <div class="settings-row">
                    <span class="label text-truncate" title="${w.title}">
                        ${wsName} <span class="text-xs text-muted">${isMin}</span>
                    </span>
                    <button class="settings-btn settings-btn-sm" onclick="focusWindow(${w.hwnd})">聚焦</button>
                </div>
            </div>
        `;
    });
    if (!html) html = '<div class="text-muted text-sm">无活跃窗口</div>';
    wSec.innerHTML = `<h3>🪟 工作区窗口管理 (${data.count}个)</h3>${html}`;
}

export async function focusWindow(hwnd) {
    try {
        await fetch(`${BASE_URL}/v1/system/windows/${hwnd}/action`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "focus" })
        });
    } catch (e) { alert('聚焦失败'); }
}

export async function fetchProcesses(forceRefresh = false) {
    try {
        const url = `${BASE_URL}/v1/system/processes?main_only=true` + (forceRefresh ? "&force_refresh=true" : "");
        const res = await fetch(url);
        const data = await res.json();
        let totalMem = 0;
        let procHtml = '';
        (data.processes || []).forEach(p => {
            totalMem += (p.memory_mb || 0);

            let winHtml = '';
            if (p.windows && p.windows.length > 0) {
                p.windows.forEach(w => {
                    winHtml += `<div class="process-window">
                        <span class="text-truncate" style="flex:1;">🖥️ ${w.title}</span>
                        <button class="settings-btn settings-btn-xs" onclick="focusWindow(${w.hwnd})">唤醒</button>
                    </div>`;
                });
            }
            procHtml += `<div class="settings-item">
                <div class="settings-row">
                    <span class="label">${p.name} <span>[PID: ${p.pid}]</span></span>
                    <div class="actions-row">
                        <span>${p.memory_mb} MB</span>
                        <button class="settings-btn danger settings-btn-xs" onclick="killProcess(${p.pid})">终止</button>
                    </div>
                </div>
                ${winHtml}
            </div>`;
        });

        const html = `
            <div class="settings-row">
                <span class="label">主进程数</span>
                <span>${data.count} 个</span>
            </div>
            <div class="settings-row mt-8">
                <span class="label">总内存估算</span>
                <span>${Math.round(totalMem)} MB</span>
            </div>
            <div class="scroll-list">
                ${procHtml}
            </div>
        `;
        document.getElementById('processContent').innerHTML = html;
    } catch (e) { console.error('processes api error', e); }
}

export async function killProcess(pid) {
    if (!confirm(`确认要强制终止进程 PID: ${pid} 吗？此操作不可逆！`)) return;
    try {
        await fetch(`${BASE_URL}/v1/system/processes/${pid}/kill`, { method: 'POST' });
        fetchProcesses(true);
    } catch (e) { alert('终止失败'); }
}
