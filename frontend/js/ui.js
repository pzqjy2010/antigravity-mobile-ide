// --- UI Utils ---
import { fetchFileTree } from './file-tree.js';
import { renderSettings } from './settings.js';
import { showScreenshot } from './screenshot.js';
import { initTerminal } from './terminal.js';

export const chatContainer = document.getElementById('chatContainer');
export const inputEl = document.getElementById('chatInput');

export function toggleDrawer(name) {
    document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
    const target = document.getElementById('drawer-' + name);
    if (target) {
        target.classList.add('open');
        // 懒加载
        if (name === 'file') fetchFileTree();
        if (name === 'term') initTerminal();
        if (name === 'settings') renderSettings();
    }
}

export function closeDrawer(name) {
    document.getElementById('drawer-' + name).classList.remove('open');
    const dockBtn = document.querySelector(`.dock-item[data-drawer="${name}"]`);
    if (dockBtn) dockBtn.classList.remove('active');
}

export function closeModal() {
    document.getElementById('modal-viewer').classList.remove('open');
    document.getElementById('modalActions').innerHTML = '';
}

export function appendMsg(role, text) {
    const es = document.getElementById('emptyState');
    if (es) es.remove();
    const wrapper = document.createElement('div');
    wrapper.className = `msg ${role}`;
    wrapper.innerHTML = `<div class="bubble">${text}</div>`;
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return wrapper;
}

export function resetChatArea() {
    chatContainer.innerHTML = `
        <div id="emptyState" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:12px; opacity:0.4;">
            <div style="font-size:48px;">🚀</div>
            <div style="font-size:16px; font-weight:600;">Antigravity Mobile IDE</div>
            <div style="font-size:13px; color:var(--text-muted); text-align:center; max-width:240px;">输入消息开始与 AI 对话，或切换到其他面板 浏览工作区</div>
        </div>`;
}

export function initDock() {
    document.querySelectorAll('.dock-item').forEach(item => {
        item.addEventListener('click', function () {
            const isActive = this.classList.contains('active');
            document.querySelectorAll('.dock-item').forEach(i => i.classList.remove('active'));

            if (isActive) {
                document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
            } else {
                this.classList.add('active');
                const drawerName = this.getAttribute('data-drawer');
                if (drawerName === 'screen') {
                    this.classList.remove('active');
                    showScreenshot();
                } else {
                    toggleDrawer(drawerName);
                }
            }
        });
    });
}
