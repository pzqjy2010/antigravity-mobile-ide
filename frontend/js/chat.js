// --- Chat Logic ---
import { state, BASE_URL, saveState, cacheSet, cacheGet } from './state.js';
import { chatContainer, appendMsg, resetChatArea } from './ui.js';
import { cancelCascade } from './settings.js';

// --- 会话管理 ---
export function updateSessionLabel() {
    const convs = state.conversations || [];
    const cur = convs.find(c => c.id === state.activeConvId);
    if (cur) {
        const title = cur.summary.length > 15 ? cur.summary.slice(0, 15) + '…' : cur.summary;
        document.getElementById('sessionLabel').innerText = title;
    } else {
        document.getElementById('sessionLabel').innerText = '新对话';
    }
}

export function newConversation() {
    state.activeConvId = null;
    chatContainer.innerHTML = '';
    updateSessionLabel();
}

export async function fetchConversations() {
    if (!state.activePort) return;
    try {
        const res = await fetch(`${BASE_URL}/v1/instances/${state.activePort}/conversations`);
        const data = await res.json();
        state.conversations = data.conversations || [];
        cacheSet('convs_' + state.activePort, state.conversations);
    } catch (e) {
        console.error('Error fetching conversations:', e);
        state.conversations = [];
    }
}

export function toggleSessionDropdown() {
    const dd = document.getElementById('sessionDropdown');
    if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }

    const cached = cacheGet('convs_' + state.activePort);
    if (cached && cached.data && cached.data.length > 0) {
        state.conversations = cached.data;
        renderSessionDropdown();
        dd.classList.add('open');
        if (!cached.fresh) {
            fetchConversations().then(() => renderSessionDropdown());
        }
    } else {
        dd.innerHTML = '<div class="dropdown-hint">加载中...</div>';
        dd.classList.add('open');
        fetchConversations().then(() => renderSessionDropdown());
    }
}

function renderSessionDropdown() {
    const dd = document.getElementById('sessionDropdown');
    const convs = state.conversations || [];
    if (convs.length === 0) {
        dd.innerHTML = '<div class="dropdown-hint">暂无历史会话</div>';
        return;
    }
    let html = '';
    convs.forEach((c) => {
        const isActive = c.id === state.activeConvId;
        const title = c.summary || '未命名会话';
        let timeStr = '';
        if (c.last_modified_time) {
            const d = new Date(c.last_modified_time);
            timeStr = `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        }
        html += `<div class="instance-item session-item ${isActive ? 'active' : ''}" onclick="switchSession('${c.id}')">
            <span class="session-title">${title}</span>
            <span class="session-meta">${timeStr} · ${c.step_count}步</span>
        </div>`;
    });
    dd.innerHTML = html;
}

export async function switchSession(convId) {
    document.getElementById('sessionDropdown').classList.remove('open');
    if (convId === state.activeConvId) return;
    state.activeConvId = convId;
    chatContainer.innerHTML = '<div class="loading-center">加载中...</div>';
    updateSessionLabel();
    saveState();
    await loadChatHistory(convId);
}

export async function loadChatHistory(convId) {
    try {
        const res = await fetch(`${BASE_URL}/v1/chat/history/${convId}`);
        const data = await res.json();
        if (data.found && data.messages && data.messages.length > 0) {
            chatContainer.innerHTML = '';
            data.messages.forEach(m => {
                const w = appendMsg(m.role || 'ai', '');
                const bubble = w.querySelector('.bubble');
                if (m.role === 'user') {
                    bubble.textContent = m.content || '';
                } else {
                    bubble.innerHTML = m.content || '';
                    _bindImageClickEvents(bubble);
                }
            });
            return;
        }
    } catch (e) {
        console.warn('History load failed:', e);
    }
    await loadTimeline(convId);
}

async function loadTimeline(convId) {
    try {
        const res = await fetch(`${BASE_URL}/v1/chat/history/${convId}/timeline?port=${state.activePort}`);
        const data = await res.json();
        const items = data.timeline || [];
        if (items.length === 0) { resetChatArea(); return; }
        chatContainer.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'timeline-header';
        header.innerHTML = `📋 操作足迹 (${data.total_steps} 步) · <span class="text-dimmed">完整文本未缓存</span>`;
        chatContainer.appendChild(header);

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'timeline-item';
            let timeStr = '';
            if (item.time) {
                const d = new Date(item.time);
                timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
            }
            div.innerHTML = `
                <span class="timeline-time">${timeStr}</span>
                <span>${item.icon}</span>
                <span class="timeline-label">${item.label}</span>
                <span class="timeline-detail" title="${item.detail || ''}">${item.detail || ''}</span>
            `;
            chatContainer.appendChild(div);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    } catch (e) {
        console.error('Timeline load error:', e);
        resetChatArea();
    }
}

// --- 发送消息 ---
let _chatBusy = false;

export async function sendMessage() {
    const inputStr = document.getElementById('chatInput');
    if (_chatBusy) { cancelCascade(); return; }
    const val = inputStr.value.trim();
    if (!val) return;
    inputStr.value = '';
    _setChatBusy(true);

    appendMsg('user', val);
    const aiWrapper = appendMsg('ai', '<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>');

    try {
        const res = await fetch(`${BASE_URL}/v1/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: val,
                conv_id: state.activeConvId,
                port: state.activePort,
                model: state.activeModel || undefined
            })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.conv_id) {
            state.activeConvId = data.conv_id;
            updateSessionLabel();
        }
        renderAiResponse(aiWrapper, data);
        _archiveCurrentChat();
    } catch (e) {
        console.error(e);
        aiWrapper.querySelector('.bubble').innerHTML = `<span class="text-danger">❌ 请求失败: ${e.message}</span>`;
    }
    _setChatBusy(false);
}

function _archiveCurrentChat() {
    if (!state.activeConvId) return;
    const bubbles = chatContainer.querySelectorAll('.msg');
    if (!bubbles.length) return;
    const messages = [];
    bubbles.forEach(wrapper => {
        const role = wrapper.classList.contains('user') ? 'user' : 'ai';
        const bubble = wrapper.querySelector('.bubble');
        if (!bubble) return;
        messages.push({
            role: role,
            content: role === 'user' ? bubble.textContent : bubble.innerHTML,
            timestamp: new Date().toISOString()
        });
    });
    fetch(`${BASE_URL}/v1/chat/history/${state.activeConvId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cascade_id: state.activeConvId, messages, port: state.activePort })
    }).catch(e => console.warn('Archive failed:', e));
}

function _setChatBusy(busy) {
    _chatBusy = busy;
    const btn = document.getElementById('sendBtn');
    if (busy) {
        btn.innerText = '🛑';
        btn.style.background = 'var(--danger)';
        btn.title = '停止 AI';
    } else {
        btn.innerText = '➤';
        btn.style.background = 'var(--primary)';
        btn.title = '发送';
    }
}

function renderAiResponse(wrapper, data) {
    const bubble = wrapper.querySelector('.bubble');
    if (data.error) {
        bubble.innerHTML = `<span class="text-danger">❌ 执行出错: ${data.error}</span>`;
        return;
    }

    const replyHtml = (typeof marked !== 'undefined' && data.reply) ? marked.parse(data.reply) : (data.reply || '');
    let html = `<div>${replyHtml}</div>`;

    if (data.actions && data.actions.length > 0) {
        const visibleActions = data.actions.filter(act => {
            const atype = act.type || '';
            const content = act.content || '';
            if (atype === 'error' && content.toLowerCase().includes('retryable')) return false;
            if (atype === 'ephemeral_message') return false;
            return true;
        });
        if (visibleActions.length > 0) {
            html += `
            <details class="action-tree-container">
                <summary class="action-summary">
                    <span class="dropdown-arrow">▶</span> 查看详细执行过程 (${visibleActions.length}步)
                </summary>
                <div class="action-tree">
            `;
            visibleActions.forEach(act => {
                let icon = '⚙️';
                const atype = act.type || '';
                if (atype === 'planner_response') icon = '🤖';
                else if (atype === 'user_input') icon = '💬';
                else if (atype === 'error') icon = '❌';
                else if (atype.includes('code_action') || atype.includes('file_edit')) icon = '📝';
                else if (atype.includes('run_command') || atype.includes('command')) icon = '📜';
                else if (atype.includes('search') || atype.includes('grep') || atype.includes('find')) icon = '🔍';
                else if (atype.includes('list_dir') || atype.includes('directory')) icon = '📁';
                else if (atype.includes('view_code') || atype.includes('view_file')) icon = '👁️';
                else if (atype.includes('task_boundary')) icon = '📌';
                else if (atype.includes('checkpoint')) icon = '💾';

                const label = act.content || atype;
                const shortLabel = label.length > 40 ? label.slice(0, 40) + '…' : label;
                html += `
                    <div class="action-node">
                        <div class="action-card clickable">
                            <div><span class="action-icon">${icon}</span> <b>${atype}</b></div>
                            <span class="action-detail" title="${label}">${shortLabel}</span>
                        </div>
                    </div>
                `;
            });
            html += `</div></details>`;
            html += `<div class="completion-bar">✅ 执行完毕，耗时 ${data.elapsed} 秒</div>`;
        }
    }

    bubble.innerHTML = html;
    _bindImageClickEvents(bubble);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/** 给容器内所有 img 绑定点击 → 全屏查看 */
function _bindImageClickEvents(container) {
    container.querySelectorAll('img').forEach(img => {
        img.classList.add('chat-img');
        img.style.cursor = 'pointer';
        img.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof openImageViewer === 'function') {
                openImageViewer(img.src);
            }
        });
    });
}
