# 开发路线图

## 已完成 ✅

- [x] 移动端 Web IDE（聊天/文件树/终端/截图/设置）
- [x] 多终端管理
- [x] 聊天图片点击查看
- [x] CC BY-NC-SA 4.0 许可证 + 免责声明

## 计划中 📋

### 跨平台兼容（macOS / Linux）

当前仅支持 Windows，以下为跨平台适配清单：

| 优先级 | 模块 | 当前实现 | 适配方式 | 工作量 |
|--------|------|---------|---------|--------|
| P0 | 终端编码 | GBK fallback (`api_server.py:773`) | `locale.getpreferredencoding()` | ~5 行 |
| P0 | 路径处理 | 硬编码 `C:\` 盘符 (`ag_core.py:107-131`) | 按 `platform.system()` 分支 | ~20 行 |
| P0 | 进程名 | `Antigravity.exe` 硬编码 (`api_server.py:1453`) | 按平台判断进程名 | ~5 行 |
| P1 | 截图 | `mss` + 窗口定位用 Win32 API | `mss` 全屏已跨平台，窗口截图按平台分支 | ~50 行 |
| P2 | 窗口管理 | `ctypes.windll.user32` (~200 行) | macOS: `osascript`, Linux: `xdotool` | ~200 行 |

### 开源改造（可选）

- [ ] 抽象 `BaseConnector` 接口
- [ ] `connector_config.py` 骨架实现
- [ ] `ag_core.py` → `connector_ag.py` + .gitignore
- [ ] AI Agent 指引文档

### 功能增强

- [ ] AI 图片生成显示（确认 AG 返回格式后实现）
- [ ] 文件编辑器（代码高亮 + 保存）
- [ ] 会话管理（创建/切换/删除）
