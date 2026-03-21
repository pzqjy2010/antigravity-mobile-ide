// --- 文件树 ---
import { state, BASE_URL } from './state.js';

export async function fetchFileTree() {
    initContextMenu();
    if (!state.activePort) return;
    const container = document.getElementById('fileTreeContainer');
    container.innerHTML = '<div style="color:var(--text-muted)">加载中...</div>';
    try {
        const res = await fetch(`${BASE_URL}/v1/workspace/files?port=${state.activePort}&path=`);
        const data = await res.json();
        if (data.error) throw new Error(data.detail || data.error);
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
            // 默认合并子目录 (collapsed)
            div.innerHTML = `<div class="tree-item">
                                <span class="tree-toggle">▶</span>
                                <span style="flex:1;">📁 ${item.name}</span>
                                <div class="tree-context-btn" style="width:44px; height:44px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:20px; color:var(--text-muted); cursor:pointer; margin-right:-10px;">⋮</div>
                             </div>
                             <div class="tree-children collapsed"></div>`;
            const toggle = div.querySelector('.tree-item');
            const children = div.querySelector('.tree-children');
            const toggleIcon = div.querySelector('.tree-toggle');
            const contextBtn = div.querySelector('.tree-context-btn');
            
            if (contextBtn) {
                contextBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    showContextMenu(e, item, div);
                });
            }

            toggle.addEventListener('click', async () => {
                const isClosed = children.classList.contains('collapsed');
                if (isClosed) {
                    toggleIcon.classList.add('open');
                    children.classList.remove('collapsed');
                    
                    // 按需懒加载子目录
                    if (item.children === null || item.children === undefined) {
                        children.innerHTML = '<div class="tree-item" style="opacity:0.5"><span style="width:14px"></span> 加载中...</div>';
                        try {
                            const res = await fetch(`${BASE_URL}/v1/workspace/files?port=${state.activePort}&path=${encodeURIComponent(item.path)}`);
                            const data = await res.json();
                            if (data.error) throw new Error(data.detail || data.error);
                            children.innerHTML = '';
                            item.children = data.tree || []; // 缓存
                            renderTree(children, item.children);
                        } catch(e) {
                            children.innerHTML = `<div class="tree-item" style="color:var(--danger)"><span style="width:14px"></span> 加载失败</div>`;
                            item.children = null; // 允许再试
                        }
                    }
                } else {
                    toggleIcon.classList.remove('open');
                    children.classList.add('collapsed');
                }
            });
            if (item.children && Array.isArray(item.children)) {
                renderTree(children, item.children);
            }
            parent.appendChild(div);
        } else {
            const div = document.createElement('div');
            div.className = 'tree-item';
            const sizeKB = item.size > 1024 ? `${(item.size / 1024).toFixed(1)}KB` : `${item.size}B`;
            div.innerHTML = `<span style="width:14px;"></span> 📄 <span style="flex:1;">${item.name}</span> 
                             <span style="font-size:10px; opacity:0.3; margin-right:4px;">${sizeKB}</span>
                             <div class="tree-context-btn" style="width:44px; height:44px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:20px; color:var(--text-muted); cursor:pointer; margin-right:-10px;">⋮</div>`;
            
            const contextBtn = div.querySelector('.tree-context-btn');
            if (contextBtn) {
                contextBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    showContextMenu(e, item, div);
                });
            }

            div.addEventListener('click', () => {
                openFile(item.path, item.name);
            });
            parent.appendChild(div);
        }
    });
}

// --- Context Menu Logic ---
let isContextBound = false;
let currentContextItem = null;

function initContextMenu() {
    if (isContextBound) return;
    isContextBound = true;
    
    const hideContextMenu = () => {
        const m = document.getElementById('fileContextMenu');
        if (m) m.style.display = 'none';
    };

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('touchstart', (e) => {
        const m = document.getElementById('fileContextMenu');
        if (m && m.style.display !== 'none' && !e.target.closest('#fileContextMenu')) {
            hideContextMenu();
        }
    });

    const copyBtn = document.getElementById('menuCopyPath');
    const mentionBtn = document.getElementById('menuMentionFile');
    const refreshBtn = document.getElementById('menuRefreshDir');
    
    if (copyBtn) copyBtn.onclick = async () => {
        if (!currentContextItem) return;
        try {
            await navigator.clipboard.writeText(currentContextItem.item.path);
            import('./ui.js').then(m => m.showToast('已复制路径'));
        } catch(e) {}
        hideContextMenu();
    };
    
    if (mentionBtn) mentionBtn.onclick = () => {
        if (!currentContextItem) return;
        const input = document.getElementById('chatInput');
        if (input) {
            input.value += (input.value ? ' ' : '') + '@file:' + currentContextItem.item.path + ' ';
            input.focus();
        }
        import('./ui.js').then(m => m.closeDrawer('file'));
        hideContextMenu();
    };
    
    if (refreshBtn) refreshBtn.onclick = () => {
        if (!currentContextItem || currentContextItem.item.type !== 'dir') return;
        const item = currentContextItem.item;
        item.children = null; // 清除缓存
        const div = currentContextItem.div;
        
        const childrenDiv = div.querySelector('.tree-children');
        const toggleIcon = div.querySelector('.tree-toggle');
        const treeItemBtn = div.querySelector('.tree-item');
        
        if (!childrenDiv.classList.contains('collapsed')) {
             childrenDiv.classList.add('collapsed');
             toggleIcon.classList.remove('open');
        }
        treeItemBtn.click();
        hideContextMenu();
    };
}

function showContextMenu(e, itemData, parentDiv) {
    if (navigator.vibrate) {
        try { navigator.vibrate(50); } catch(ex){}
    }
    currentContextItem = { item: itemData, div: parentDiv };
    const m = document.getElementById('fileContextMenu');
    if (!m) return;
    
    const refreshBtn = document.getElementById('menuRefreshDir');
    if (refreshBtn) refreshBtn.style.display = itemData.type === 'dir' ? 'flex' : 'none';
    
    let x = e.clientX;
    let y = e.clientY;
    
    // Fallback if clientX is undefined on specific touch clicks
    if (x === undefined || y === undefined || (x === 0 && y === 0)) {
        if (e.target && e.target.getBoundingClientRect) {
            const rect = e.target.getBoundingClientRect();
            x = rect.left - 100; // offset slightly to the left
            y = rect.bottom;
        } else {
            x = window.innerWidth / 2;
            y = window.innerHeight / 2;
        }
    }
    
    m.style.display = 'block';
    if (x + m.offsetWidth > window.innerWidth) x = window.innerWidth - m.offsetWidth - 10;
    if (y + m.offsetHeight > window.innerHeight) y = window.innerHeight - m.offsetHeight - 10;
    
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
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
        const MAX_LINES = 3000;
        let isTruncated = false;
        if (lines.length > MAX_LINES) {
            lines.length = MAX_LINES;
            isTruncated = true;
        }

        const styleHtml = `<style>
            .code-line-tr { display: block; position: relative; min-height: 1.2em; white-space: pre; }
            .code-line-tr::before {
                counter-increment: line; content: counter(line);
                position: absolute; left: -3.5em; width: 3em; text-align: right;
                color: rgba(255,255,255,0.3); user-select: none; font-size: 0.9em;
            }
        </style>`;

        let html = '<div class="code-viewer"><pre style="counter-reset: line; padding-left: 3.5em; overflow-x: auto;">';
        lines.forEach((line) => {
            const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += `<span class="code-line-tr">${escaped}</span>`;
        });
        html += '</pre></div>';

        if (isTruncated) {
            html = `<div style="background:rgba(245,158,11,0.2); color:#fcd34d; padding:8px 16px; margin: 10px; border-radius:4px; font-size:13px; text-align:center;">⚠️ 文件过大，为保证流畅度已截断显示前 ${MAX_LINES} 行</div>` + html;
        }
        
        document.getElementById('modalContent').innerHTML = styleHtml + html;
    } catch (e) {
        document.getElementById('modalContent').innerHTML = `<div style="color:var(--danger); padding:20px;">无法打开: ${e.message}</div>`;
    }
}
