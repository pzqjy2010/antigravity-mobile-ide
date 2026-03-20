// --- 远程终端 ---
import { state, BASE_URL } from './state.js';

export async function execCommand() {
    const input = document.getElementById('termInput');
    const cmd = input.value.trim();
    if (!cmd) return;
    input.value = '';
    const output = document.getElementById('termOutput');
    output.textContent += `\n$ ${cmd}\n执行中...\n`;
    output.scrollTop = output.scrollHeight;
    try {
        const res = await fetch(`${BASE_URL}/v1/system/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmd, port: state.activePort })
        });
        const data = await res.json();
        output.textContent = output.textContent.replace('执行中...\n', '');
        if (data.stdout) output.textContent += data.stdout;
        if (data.stderr) output.textContent += data.stderr;
        if (data.cwd) document.getElementById('termCwd').textContent = `cwd: ${data.cwd}`;
    } catch (e) {
        output.textContent = output.textContent.replace('执行中...\n', '');
        output.textContent += `错误: ${e.message}\n`;
    }
    output.scrollTop = output.scrollHeight;
}
