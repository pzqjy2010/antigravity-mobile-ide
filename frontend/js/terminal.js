// --- 多终端管理 ---
import { state, BASE_URL } from './state.js';

// 终端状态
const terms = {
    sessions: [],      // [{id, name, cwd, ...}]
    activeId: null,     // 当前激活的终端 ID
    outputs: {},        // tid -> 累积的输出文本
    executing: {},      // tid -> boolean 执行中标记
};

/** 获取当前终端 */
function active() {
    return terms.sessions.find(s => s.id === terms.activeId);
}

// ─── API ───

async function apiCreateTerminal(name, cwd) {
    const res = await fetch(`${BASE_URL}/v1/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cwd, port: state.activePort }),
    });
    return res.json();
}

async function apiListTerminals() {
    const res = await fetch(`${BASE_URL}/v1/terminals`);
    return res.json();
}

async function apiExecInTerminal(tid, command, timeout = 30) {
    const res = await fetch(`${BASE_URL}/v1/terminals/${tid}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, timeout }),
    });
    return res.json();
}

async function apiDeleteTerminal(tid) {
    const res = await fetch(`${BASE_URL}/v1/terminals/${tid}`, { method: 'DELETE' });
    return res.json();
}

async function apiClearTerminal(tid) {
    const res = await fetch(`${BASE_URL}/v1/terminals/${tid}/clear`, { method: 'POST' });
    return res.json();
}

// ─── 渲染 ───

function renderTabs() {
    const tabBar = document.getElementById('termTabs');
    if (!tabBar) return;
    let html = '';
    for (const s of terms.sessions) {
        const isActive = s.id === terms.activeId;
        html += `<div class="term-tab ${isActive ? 'active' : ''}" data-tid="${s.id}" onclick="switchTerminal('${s.id}')">
            <span class="term-tab-name">${escHtml(s.name)}</span>
            <span class="term-tab-close" onclick="event.stopPropagation(); closeTerminal('${s.id}')" title="关闭">×</span>
        </div>`;
    }
    html += `<div class="term-tab term-tab-add" onclick="createTerminal()" title="新建终端">＋</div>`;
    tabBar.innerHTML = html;
}

function renderOutput() {
    const output = document.getElementById('termOutput');
    const cwdEl = document.getElementById('termCwd');
    if (!output) return;

    const s = active();
    if (!s) {
        output.textContent = '点击 ＋ 新建一个终端会话';
        if (cwdEl) cwdEl.textContent = '';
        return;
    }

    output.textContent = terms.outputs[s.id] || '';
    output.scrollTop = output.scrollHeight;
    if (cwdEl) cwdEl.textContent = s.cwd || '';
}

function appendOutput(tid, text) {
    if (!terms.outputs[tid]) terms.outputs[tid] = '';
    terms.outputs[tid] += text;
    if (tid === terms.activeId) renderOutput();
}

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 操作 ───

export async function createTerminal(name) {
    try {
        const s = await apiCreateTerminal(name || null, null);
        terms.sessions.push(s);
        terms.outputs[s.id] = `终端 "${s.name}" 已创建\ncwd: ${s.cwd}\n\n`;
        terms.activeId = s.id;
        renderTabs();
        renderOutput();
        // 聚焦输入框
        document.getElementById('termInput')?.focus();
    } catch (e) {
        appendOutput(terms.activeId || '_', `创建终端失败: ${e.message}\n`);
    }
}

export async function switchTerminal(tid) {
    if (!terms.sessions.find(s => s.id === tid)) return;
    terms.activeId = tid;
    renderTabs();
    renderOutput();
    document.getElementById('termInput')?.focus();
}

export async function closeTerminal(tid) {
    try {
        await apiDeleteTerminal(tid);
    } catch (e) { /* 忽略 */ }
    terms.sessions = terms.sessions.filter(s => s.id !== tid);
    delete terms.outputs[tid];
    delete terms.executing[tid];
    // 切到前一个终端
    if (terms.activeId === tid) {
        terms.activeId = terms.sessions.length > 0 ? terms.sessions[terms.sessions.length - 1].id : null;
    }
    renderTabs();
    renderOutput();
}

export async function clearTerminal() {
    const s = active();
    if (!s) return;
    try {
        await apiClearTerminal(s.id);
    } catch (e) { /* 忽略 */ }
    terms.outputs[s.id] = '';
    renderOutput();
}

export async function runTermCommand() {
    const input = document.getElementById('termInput');
    const cmd = (input?.value || '').trim();
    if (!cmd) return;
    input.value = '';

    const s = active();
    if (!s) {
        // 没有终端，自动创建一个
        await createTerminal();
        // 重新获取
        const newS = active();
        if (!newS) return;
        await _doExec(newS, cmd);
        return;
    }
    await _doExec(s, cmd);
}

async function _doExec(session, cmd) {
    if (terms.executing[session.id]) return; // 防重入
    terms.executing[session.id] = true;

    appendOutput(session.id, `$ ${cmd}\n`);
    const sendBtn = document.getElementById('termExecBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '...'; }

    try {
        const data = await apiExecInTerminal(session.id, cmd);
        let out = '';
        if (data.stdout) out += data.stdout;
        if (data.stderr) out += data.stderr;
        if (!out && data.exit_code === 0) out = ''; // 空输出正常
        if (data.exit_code !== 0 && !out) out = `退出码: ${data.exit_code}\n`;
        if (out && !out.endsWith('\n')) out += '\n';
        appendOutput(session.id, out);

        // 更新 cwd
        if (data.cwd) {
            session.cwd = data.cwd;
            if (session.id === terms.activeId) {
                const cwdEl = document.getElementById('termCwd');
                if (cwdEl) cwdEl.textContent = data.cwd;
            }
        }
    } catch (e) {
        appendOutput(session.id, `错误: ${e.message}\n`);
    } finally {
        terms.executing[session.id] = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '执行'; }
    }
}

/** 打开终端抽屉时自动初始化 */
export async function initTerminal() {
    // 同步服务端已有的终端列表
    try {
        const data = await apiListTerminals();
        terms.sessions = data.terminals || [];
        // 恢复之前的 activeId，或选第一个
        if (terms.sessions.length > 0) {
            if (!terms.sessions.find(s => s.id === terms.activeId)) {
                terms.activeId = terms.sessions[0].id;
            }
            // 拉取每个终端的历史来恢复输出
            for (const s of terms.sessions) {
                if (!terms.outputs[s.id]) {
                    try {
                        const detail = await fetch(`${BASE_URL}/v1/terminals/${s.id}?history=true`).then(r => r.json());
                        let output = '';
                        for (const h of (detail.history || [])) {
                            output += `$ ${h.command}\n`;
                            if (h.stdout) output += h.stdout;
                            if (h.stderr) output += h.stderr;
                            if (output && !output.endsWith('\n')) output += '\n';
                        }
                        terms.outputs[s.id] = output;
                    } catch (e) { /* 忽略 */ }
                }
            }
        }
    } catch (e) { /* 忽略，可能服务还没启动 */ }

    renderTabs();
    renderOutput();

    // 如果没有任何终端，自动创建一个
    if (terms.sessions.length === 0) {
        await createTerminal();
    }
}
