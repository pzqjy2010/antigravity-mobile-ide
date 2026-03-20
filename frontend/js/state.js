// --- State Management ---
export const state = {
    activePort: null,
    activeConvId: null,
    activeModel: null,
    instances: [],
    models: [],
    conversations: [],
    pollingInterval: null,
    userName: null,
    userPlan: null,
    modelsData: null
};

export const BASE_URL = '';
const _LS_KEY = 'ag_mobile_state';

export function saveState() {
    try {
        localStorage.setItem(_LS_KEY, JSON.stringify({
            port: state.activePort,
            convId: state.activeConvId,
            model: state.activeModel,
            modelLabel: document.getElementById('modelName')?.innerText || '',
        }));
    } catch (e) { }
}

export function restoreSaved() {
    try {
        return JSON.parse(localStorage.getItem(_LS_KEY) || '{}');
    } catch (e) { return {}; }
}

// --- Stale-While-Revalidate 缓存 ---
const _CACHE_TTL = 5 * 60 * 1000; // 5分钟

export function cacheSet(key, data) {
    try { localStorage.setItem('ag_cache_' + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { }
}

export function cacheGet(key) {
    try {
        const raw = localStorage.getItem('ag_cache_' + key);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return { data: obj.d, fresh: (Date.now() - obj.t) < _CACHE_TTL };
    } catch (e) { return null; }
}
