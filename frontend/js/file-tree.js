// --- 文件树 ---
import { state, BASE_URL } from './state.js';

export async function fetchFileTree() {
    if (!state.activePort) return;
    const container = document.getElementById('fileTreeContainer');
    container.innerHTML = '<div style="color:var(--text-muted)">加载中...</div>';
    try {
        const res = await fetch(`${BASE_URL}/v1/workspace/files?port=${state.activePort}`);
        const data = await res.json();
        container.innerHTML = '<div class="file-tree"></div>';
        const tree = container.querySelector('.file-tree');
        renderTree(tree, data.tree || []);
    } catch (e) {
        container.innerHTML = `<div style="color:var(--danger)">加载失败: ${e.message}</div>`;
    }
}

function renderTree(parent, items) {
    items.forEach(item => {
        if (item.type === 'dir') {
            const div = document.createElement('div');
            div.className = 'tree-dir';
            div.innerHTML = `<div class="tree-item"><span class="tree-toggle open">▶</span> 📁 ${item.name}</div>
                             <div class="tree-children"></div>`;
            const toggle = div.querySelector('.tree-item');
            const children = div.querySelector('.tree-children');
            toggle.addEventListener('click', () => {
                children.classList.toggle('collapsed');
                div.querySelector('.tree-toggle').classList.toggle('open');
            });
            if (item.children) renderTree(children, item.children);
            parent.appendChild(div);
        } else {
            const div = document.createElement('div');
            div.className = 'tree-item';
            const sizeKB = item.size > 1024 ? `${(item.size / 1024).toFixed(1)}KB` : `${item.size}B`;
            div.innerHTML = `<span style="width:14px;"></span> 📄 <span style="flex:1;">${item.name}</span> <span style="font-size:10px; opacity:0.3;">${sizeKB}</span>`;
            div.addEventListener('click', () => openFile(item.path, item.name));
            parent.appendChild(div);
        }
    });
}

export async function openFile(path, name) {
    document.getElementById('modalTitle').innerText = name;
    document.getElementById('modalActions').innerHTML = '';
    document.getElementById('modalContent').innerHTML = '<div style="color:white; padding:20px;">加载中...</div>';
    document.getElementById('modal-viewer').classList.add('open');
    try {
        const res = await fetch(`${BASE_URL}/v1/workspace/file?port=${state.activePort}&path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.detail || data.error);
        const lines = data.content.split('\n');
        let html = '<div class="code-viewer"><pre>';
        lines.forEach((line, i) => {
            const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += `<div class="code-line"> <span class="code-line-num">${i + 1}</span><span>${escaped}</span></div>`;
        });
        html += '</pre></div>';
        document.getElementById('modalContent').innerHTML = html;
    } catch (e) {
        document.getElementById('modalContent').innerHTML = `<div style="color:var(--danger); padding:20px;">无法打开: ${e.message}</div>`;
    }
}
