// --- 模型管理 ---
import { state, BASE_URL, saveState, cacheSet, cacheGet } from './state.js';
import { fetchInstances } from './instances.js';

export async function fetchStatus() {
    if (!state.activePort) return;
    const cached = cacheGet('status_' + state.activePort);
    if (cached) {
        _applyUserStatus(cached.data);
        if (cached.fresh) return;
    }
    try {
        const res = await fetch(`${BASE_URL}/v1/ls/user-status?port=${state.activePort}`);
        if (res.status === 503) {
            console.warn('LS 断连，自动重新发现实例...');
            await fetchInstances();
            return;
        }
        const data = await res.json();
        cacheSet('status_' + state.activePort, data);
        _applyUserStatus(data);
    } catch (e) { console.error('Error fetching status:', e); }
}

function _applyUserStatus(data) {
    if (data.userStatus) {
        const u = data.userStatus;
        const name = u.name ? u.name.split(' ')[0] : 'User';
        let plan = 'Free';
        if (u.userTier) plan = u.userTier.name || plan;
        else if (u.planStatus && u.planStatus.planInfo) {
            const pn = u.planStatus.planInfo.planName || '';
            if (pn.includes('Ultra')) plan = 'Ultra';
            else if (pn.includes('Pro') || pn.includes('Cloud')) plan = 'Pro';
            else plan = pn || 'Free';
        }
        state.userName = name;
        state.userPlan = plan;
    }
}

export async function fetchModels() {
    if (!state.activePort) return;
    const cached = cacheGet('models_' + state.activePort);
    if (cached) {
        _applyModelsData(cached.data);
        if (cached.fresh) return;
    }
    try {
        const res = await fetch(`${BASE_URL}/v1/ls/models?port=${state.activePort}`);
        if (res.status === 503) {
            console.warn('LS 断连，自动重新发现实例...');
            await fetchInstances();
            return;
        }
        const data = await res.json();
        cacheSet('models_' + state.activePort, data);
        _applyModelsData(data);
    } catch (e) { console.error('Error fetching models:', e); }
}

function _applyModelsData(data) {
    let cur = "Unknown";
    let curLabel = "Unknown";
    if (data.defaultOverrideModelConfig && data.defaultOverrideModelConfig.modelOrAlias) {
        cur = data.defaultOverrideModelConfig.modelOrAlias.model;
    }
    function getVendor(str) {
        const s = str.toLowerCase();
        if (s.includes('gemini') || s.includes('flash')) return 'gemini';
        if (s.includes('claude') || s.includes('sonnet') || s.includes('opus')) return 'claude';
        if (s.includes('gpt') || s.includes('oss')) return 'openai';
        return 'other';
    }
    const configs = data.clientModelConfigs || data.models || [];
    const parsed = configs.map(m => {
        const modelId = (m.modelOrAlias && m.modelOrAlias.model) ? m.modelOrAlias.model : m.model;
        const label = m.label || modelId;
        const vendor = getVendor(label);
        if (modelId === cur) curLabel = label;
        let quota = m.quotaInfo?.remainingFraction;
        return { model: modelId, label, vendor, quota };
    });
    state.modelsData = parsed;
    if (!state.activeModel) {
        state.activeModel = cur;
        const el = document.getElementById('modelName');
        if (el) el.innerText = curLabel;
    }
}

export async function initModelDropdown() {
    document.getElementById('modelSelector').addEventListener('click', async function () {
        const dd = document.getElementById('modelDropdown');
        if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
        let models = state.modelsData || [];
        if (models.length === 0) {
            dd.innerHTML = '<div class="dropdown-hint">加载中...</div>';
            dd.classList.add('open');
            await fetchModels();
            models = state.modelsData || [];
            if (models.length === 0) {
                dd.innerHTML = '<div class="dropdown-hint">无可用模型</div>';
                return;
            }
        }
        {
            let html = '';
            let lastVendor = '';
            const vendorLabels = { gemini: 'Google Gemini', claude: 'Anthropic Claude', openai: 'OpenAI', other: '其他' };
            const vendorOrder = { gemini: 0, claude: 1, openai: 2, other: 3 };
            const sorted = [...models].sort((a, b) => (vendorOrder[a.vendor] ?? 9) - (vendorOrder[b.vendor] ?? 9));
            sorted.forEach(m => {
                if (m.vendor && m.vendor !== lastVendor) {
                    const separator = lastVendor ? ' vendor-separator' : '';
                    html += `<div class="vendor-header${separator}">${vendorLabels[m.vendor] || m.vendor}</div>`;
                    lastVendor = m.vendor;
                }
                const isActive = m.model === state.activeModel;
                const badgeHtml = m.badge ? `<span class="text-xs text-dimmed" style="margin-left:8px; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:10px;">${m.badge}</span>` : '';
                html += `<div class="instance-item ${isActive ? 'active' : ''}" onclick="selectModel('${m.model}', '${m.label}')">
                    <span style="font-weight:${isActive ? 600 : 400};">${m.label}</span>${badgeHtml}
                </div>`;
            });
            dd.innerHTML = html;
        }
        dd.classList.add('open');
    });
}

export function selectModel(model, label) {
    document.getElementById('modelDropdown').classList.remove('open');
    state.activeModel = model;
    document.getElementById('modelName').innerText = label;
    saveState();
}
