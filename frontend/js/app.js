// --- 入口：初始化 + 全局事件绑定 ---
import { initDock, closeDrawer, closeModal } from './ui.js';
import { newConversation, toggleSessionDropdown, switchSession, sendMessage, initImageAttach, initPolling } from './chat.js';
import { toggleInstanceDropdown, switchInstance, fetchInstances } from './instances.js';
import { initModelDropdown, selectModel } from './models.js';
import { showScreenshot, focusSpecificWindow } from './screenshot.js';
import { fetchFileTree } from './file-tree.js';
import { runTermCommand, createTerminal, switchTerminal, closeTerminal, clearTerminal, initTerminal } from './terminal.js';
import { renderSettings, refreshInstances, openNewWorkspace, cancelCascade, toggleAutoScroll, focusWindow, fetchProcesses, killProcess } from './settings.js';
import { initImageViewer } from './image-viewer.js';

// --- 把模块函数挂到 window 上，供 HTML onclick 调用 ---
window.toggleInstanceDropdown = toggleInstanceDropdown;
window.switchInstance = switchInstance;
window.toggleSessionDropdown = toggleSessionDropdown;
window.switchSession = switchSession;
window.newConversation = newConversation;
window.showScreenshot = showScreenshot;
window.focusSpecificWindow = focusSpecificWindow;
window.closeDrawer = closeDrawer;
window.closeModal = closeModal;
window.fetchFileTree = fetchFileTree;
window.runTermCommand = runTermCommand;
window.createTerminal = createTerminal;
window.switchTerminal = switchTerminal;
window.closeTerminal = closeTerminal;
window.clearTerminal = clearTerminal;
window.renderSettings = renderSettings;
window.refreshInstances = refreshInstances;
window.openNewWorkspace = openNewWorkspace;
window.cancelCascade = cancelCascade;
window.toggleAutoScroll = toggleAutoScroll;
window.focusWindow = focusWindow;
window.fetchProcesses = fetchProcesses;
window.killProcess = killProcess;
window.selectModel = selectModel;
window.sendMessage = sendMessage;

// --- 全局点击关闭下拉 ---
document.addEventListener('click', e => {
    if (!e.target.closest('#instanceSelector') && !e.target.closest('#instanceDropdown')) {
        document.getElementById('instanceDropdown').classList.remove('open');
    }
    if (!e.target.closest('#sessionSelector') && !e.target.closest('#sessionDropdown')) {
        document.getElementById('sessionDropdown').classList.remove('open');
    }
    if (!e.target.closest('#modelSelector') && !e.target.closest('#modelDropdown')) {
        document.getElementById('modelDropdown').classList.remove('open');
    }
});

// --- 发送按钮 + Enter ---
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
});

// --- Init ---
window.onload = () => {
    initDock();
    initModelDropdown();
    initImageViewer();
    initImageAttach();
    fetchInstances();
    initPolling();
};
