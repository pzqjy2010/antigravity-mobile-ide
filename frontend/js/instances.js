// --- 实例管理 ---
import { state, BASE_URL, saveState, restoreSaved, cacheGet } from './state.js';
import { resetChatArea } from './ui.js';
import { updateSessionLabel, loadChatHistory } from './chat.js';
import { fetchStatus, fetchModels } from './models.js';

export function toggleInstanceDropdown() {
    const dd = document.getElementById('instanceDropdown');
    if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
    if (!state.instances || state.instances.length === 0) {
        dd.innerHTML = '<div class="dropdown-hint">加载中...</div>';
        dd.classList.add('open');
        fetchInstances().then(() => {
            if (state.instances && state.instances.length > 0) _renderInstanceDropdown(dd);
            else dd.innerHTML = '<div class="dropdown-hint">暂无实例</div>';
        });
        return;
    }
    _renderInstanceDropdown(dd);
    dd.classList.add('open');
}

function _renderInstanceDropdown(dd) {
    let html = '';
    state.instances.forEach(i => {
        const name = i.display_name || i.workspace;
        const isActive = (i.port === state.activePort);
        const dotCls = isActive ? '' : ' style="background:var(--text-muted); box-shadow:none;"';
        html += `<div class="instance-item ${isActive ? 'active' : ''}" onclick="switchInstance(${i.port})">
            <span class="status-dot"${dotCls}></span>
            <span style="font-weight:600;">${name}</span>
            <span class="text-xs text-dimmed" style="margin-left:auto;">:${i.port}</span>
        </div>`;
    });
    dd.innerHTML = html;
}

export async function switchInstance(port) {
    document.getElementById('instanceDropdown').classList.remove('open');
    if (port === state.activePort) return;
    state.activePort = port;
    const t = state.instances.find(i => i.port === port);
    if (t) document.getElementById('instanceName').innerText = t.display_name || t.workspace;
    state.activeConvId = null;
    resetChatArea();
    updateSessionLabel();
    saveState();
    await fetchStatus();
    await fetchModels();
}

export async function fetchInstances() {
    try {
        const res = await fetch(`${BASE_URL}/v1/instances`);
        const data = await res.json();
        state.instances = data.instances || [];
        if (state.instances.length > 0) {
            const saved = restoreSaved();
            let target = state.instances[0];
            if (saved.port) {
                const savedInst = state.instances.find(i => i.port === saved.port);
                if (savedInst) target = savedInst;
            } else {
                const target5490 = state.instances.find(i => i.port === 5490);
                if (target5490) target = target5490;
            }
            state.activePort = target.port;
            if (saved.convId && saved.port === target.port) {
                state.activeConvId = saved.convId;
            }
            if (saved.model) {
                state.activeModel = saved.model;
                if (saved.modelLabel) document.getElementById('modelName').innerText = saved.modelLabel;
            }
            document.getElementById('instanceName').innerText = target.display_name || target.workspace;
            const cachedConvs = cacheGet('convs_' + target.port);
            if (cachedConvs && cachedConvs.data) state.conversations = cachedConvs.data;
            updateSessionLabel();
            fetchStatus();
            fetchModels();
            if (state.activeConvId) {
                loadChatHistory(state.activeConvId);
            } else {
                resetChatArea();
            }
        } else {
            document.getElementById('instanceName').innerText = "无工作区";
            resetChatArea();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('instanceName').innerText = "离线";
    }
}
