// --- Chat Logic ---
import { state, BASE_URL, saveState, cacheSet, cacheGet } from './state.js';
import { chatContainer, appendMsg, resetChatArea } from './ui.js';
import { cancelCascade } from './settings.js';

// --- 图片附件状态 ---
let _pendingImage = null; // { path: '绝对路径', filename: '文件名', previewUrl: 'blob:...' }

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
                    // 历史记录可能包含图片附件的 <img> 标签
                    const content = m.content || '';
                    if (content.includes('<img ')) {
                        bubble.innerHTML = content;
                        _bindImageClickEvents(bubble);
                    } else {
                        bubble.textContent = content;
                    }
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
let _chatAbortController = null;

// --- 图片附件功能 ---
export function initImageAttach() {
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('imageFileInput');
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', onImageSelected);
    }
}

async function onImageSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    // 生成本地预览
    const previewUrl = URL.createObjectURL(file);
    const bar = document.getElementById('imagePreviewBar');

    bar.innerHTML = `
        <div class="img-preview-thumb">
            <img src="${previewUrl}" alt="preview">
            <button class="remove-img" id="removeImgBtn">✕</button>
        </div>
        <div class="img-preview-info">
            <div class="filename">${file.name}</div>
            <div>上传中...</div>
        </div>
    `;
    bar.style.display = 'flex';

    document.getElementById('removeImgBtn').onclick = () => {
        clearPendingImage();
    };

    // 上传到后端
    try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE_URL}/v1/chat/upload-image`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        _pendingImage = { path: data.path, filename: data.filename, previewUrl,
                          proxyUrl: `${BASE_URL}/v1/local-file?path=${encodeURIComponent(data.path)}` };
        const info = bar.querySelector('.img-preview-info');
        if (info) info.innerHTML = `<div class="filename">${file.name}</div><div style="color:var(--success)">✅ 已就绪</div>`;
    } catch (err) {
        console.error('Image upload failed:', err);
        const info = bar.querySelector('.img-preview-info');
        if (info) info.innerHTML = `<div class="filename">${file.name}</div><div style="color:var(--danger)">❌ 上传失败</div>`;
        _pendingImage = null;
    }

    // 重置 file input 以便重复选择同一张图
    e.target.value = '';
}

function clearPendingImage() {
    _pendingImage = null;
    const bar = document.getElementById('imagePreviewBar');
    if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
}

export async function sendMessage() {
    const inputStr = document.getElementById('chatInput');
    if (_chatBusy) {
        // 先通知 LS 停止 AI 执行器（必须在 abort 之前，否则 abort 导致后端轮询取消后 LS 认为执行器已不在运行）
        await cancelCascade(state.activeConvId);
        // 再中断前端的 fetch 请求
        if (_chatAbortController) _chatAbortController.abort();
        _setChatBusy(false);
        return;
    }
    const val = inputStr.value.trim();
    if (!val && !_pendingImage) return;
    inputStr.value = '';
    _setChatBusy(true);

    // 拼装最终消息：图片 @file: + 文本
    let finalMessage = val;
    let attachedProxyUrls = [];
    if (_pendingImage) {
        const imgRef = '@file:' + _pendingImage.path;
        finalMessage = imgRef + (val ? ' ' + val : '');
        attachedProxyUrls.push(_pendingImage.proxyUrl);
        clearPendingImage();
    }

    // 自动扫描用户输入文本中的 @file: 绝对路径，如果是图片也提取出缩略图
    const imgRegex = /@file:(.*?\.(?:png|jpg|jpeg|gif|webp|bmp))/gi;
    let match;
    while ((match = imgRegex.exec(finalMessage)) !== null) {
        const path = match[1].trim();
        const proxyUrl = `${BASE_URL}/v1/local-file?path=${encodeURIComponent(path)}`;
        if (!attachedProxyUrls.includes(proxyUrl)) {
            attachedProxyUrls.push(proxyUrl);
        }
    }

    // 用户气泡：展示完整消息（含 @file: 路径），同时将图片路径渲染为缩略图
    // 将 @file:路径 替换为可读的标签 + 缩略图
    let userBubbleContent = finalMessage || '🖼️ 图片';
    if (attachedProxyUrls.length > 0) {
        // 将文本中的 @file:xxx 替换为简短标签
        let displayText = finalMessage.replace(/@file:[^\s]+/g, '').trim();
        const imgsHtml = attachedProxyUrls.map(u => `<img src="${u}" class="user-img-attachment" alt="附件">`).join('<br>');
        userBubbleContent = (displayText ? displayText + '<br>' : '') + imgsHtml;
    }
    const userWrapper = appendMsg('user', '');
    userWrapper.querySelector('.bubble').innerHTML = userBubbleContent;
    const aiWrapper = appendMsg('ai', '<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>');

    _chatAbortController = new AbortController();
    try {
        const res = await fetch(`${BASE_URL}/v1/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: finalMessage,
                conv_id: state.activeConvId,
                port: state.activePort,
                model: state.activeModel || undefined
            }),
            signal: _chatAbortController.signal
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
        if (e.name === 'AbortError') {
            aiWrapper.querySelector('.bubble').innerHTML = `<span class="text-warning">⏹️ 已手动停止</span>`;
        } else {
            console.error(e);
            aiWrapper.querySelector('.bubble').innerHTML = `<span class="text-danger">❌ 请求失败: ${e.message}</span>`;
        }
    }
    _chatAbortController = null;
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
            content: bubble.innerHTML,
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
    // 将 markdown 中的本地文件路径替换为后端代理 URL
    let reply = data.reply || '';
    // 匹配 ![alt](file:///path) 和 ![alt](C:\path) 格式
    reply = reply.replace(/!\[([^\]]*)\]\((file:\/\/\/[^)]+)\)/g, (_, alt, uri) => {
        const path = decodeURIComponent(uri.replace('file:///', ''));
        return `![${alt}](${BASE_URL}/v1/local-file?path=${encodeURIComponent(path)})`;
    });
    reply = reply.replace(/!\[([^\]]*)\]\(([A-Za-z]:\\[^)]+)\)/g, (_, alt, path) => {
        return `![${alt}](${BASE_URL}/v1/local-file?path=${encodeURIComponent(path)})`;
    });

    const replyHtml = (typeof marked !== 'undefined' && reply) ? marked.parse(reply) : reply;
    let html = `<div>${replyHtml}</div>`;

    if (data.images && data.images.length > 0) {
        data.images.forEach(img => {
            if (img.uri) {
                const encodedUri = encodeURIComponent(img.uri);
                html += `<div class="ai-generated-image-container" style="margin-top: 10px;">
                            <img src="${BASE_URL}/v1/chat/images?uri=${encodedUri}" alt="${img.imageName}" title="${img.prompt}" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--border-color); cursor: pointer;" />
                            <div style="font-size: 0.85em; color: var(--text-color); opacity: 0.7; margin-top: 5px;">${img.prompt}</div>
                         </div>`;
            }
        });
    }

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
