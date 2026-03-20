# 贡献指南

感谢关注 Antigravity Mobile IDE！本文档说明如何参与开发、对接自定义 AI 后端、以及代码规范。

## 项目定位

这是一个**通用的移动端 AI IDE 监控框架**，提供：
- 📱 移动端 Web UI（对话/文件树/终端/截图/设置）
- 🔌 可插拔的 AI 后端连接层
- 🛠 系统管理 API（进程/窗口/截图）

## 快速上手

```bash
# 克隆并安装依赖
git clone <repo-url>
cd antigravity-mobile-ide
pip install fastapi uvicorn httpx psutil mss Pillow

# 启动开发服务
python backend/api_server.py --port 16601

# 浏览器访问
http://localhost:16601/
```

## 目录结构

```
frontend/           ← 前端（纯 ES Module，无构建工具）
├── index.html      ← HTML 骨架
├── css/style.css   ← 全局样式
└── js/             ← 11 个功能模块
backend/            ← Python 后端（FastAPI）
├── api_server.py   ← API 网关 + 静态文件服务
├── ag_core.py      ← AI 后端连接层（可替换）
└── steps_parser.py ← AI 响应解析器
```

## 对接自定义 AI 后端

项目的 AI 连接层是可替换的。如果你想对接其他 AI 服务（如 OpenAI、Claude API、本地 LLM），只需实现以下接口：

### 1. 实现 Connector

创建你自己的 `my_connector.py`，提供以下方法：

```python
class MyAICore:
    def __init__(self, port: int = None):
        """初始化连接"""
        pass

    async def chat(self, message: str, conv_id: str = None,
                   model: str = None) -> ChatResult:
        """发送消息，返回 AI 回复"""
        # 调用你的 AI API
        # 返回 ChatResult(reply="...", conv_id="...")
        pass

    async def rpc_call(self, method: str, body: dict = None) -> dict:
        """通用 RPC 代理（可选）"""
        pass

    def get_instances(self) -> list[dict]:
        """返回可用实例列表"""
        return [{"port": 8080, "workspace": "default"}]
```

### 2. 替换 api_server.py 中的导入

```python
# 原始
from ag_core import AntigravityCore
# 替换为
from my_connector import MyAICore as AntigravityCore
```

### 3. ChatResult 数据结构

```python
@dataclass
class ChatResult:
    conv_id: str = ""       # 会话 ID
    reply: str = ""         # AI 回复文本（支持 Markdown）
    thinking: str = None    # 思考过程（可选）
    actions: list = []      # 执行动作列表（可选）
    elapsed: float = 0.0    # 耗时
    error: str = ""         # 错误信息
```

## 代码规范

### 前端

- **ES Module**：所有 JS 文件使用 `import/export`，`app.js` 统一通过 `window.xxx = fn` 暴露给 HTML
- **CSS 优先**：不在 JS 的 `innerHTML` 中使用内联 `style`，用语义化 CSS class
- **命名**：避免与浏览器内置方法同名（如 ~~`execCommand`~~，应使用 `runTermCommand`）
- **无构建依赖**：不引入 Webpack/Vite，保持原生 ES Module

### 后端

- **异步优先**：API 端点使用 `async def`，子进程使用 `asyncio.create_subprocess_shell`
- **Windows 兼容**：输出解码使用 UTF-8 → GBK fallback
- **缓存策略**：重量级接口使用后台定时刷新（如进程列表 30s），轻量级使用 TTL 缓存

## 提交规范

提交信息使用语义化前缀：

```
feat: 新功能
fix: 修复 bug
refactor: 重构
docs: 文档更新
style: 样式调整（不影响逻辑）
```

示例：
```
feat: 多终端管理 + 修复命令执行
fix: execCommand 与浏览器内置方法命名冲突
refactor: 内联样式提取为语义化 CSS class
```

## 免责声明

本项目为个人效率工具，仅供学习和研究目的。使用者应自行遵守所使用 AI 服务的 Terms of Service。项目维护者不对因使用本工具而导致的任何后果负责。
