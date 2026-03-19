# My Antigravity Assistant

Python 后端，封装 Antigravity Language Server 的对话能力，提供 REST API + Mobile Web IDE。

## 架构

```
my_antigravity_assitent/
├── index.html            # Mobile Web IDE 前端（单页应用）
├── api_server.py         # FastAPI 服务器（30+ REST 端点）
├── ag_core.py            # AntigravityCore 业务层（发消息 → 轮询 → 解析）
├── steps_parser.py       # Steps JSON 解析器
└── test_steps_parser.py  # 解析器单元测试
```

依赖：`ls_connector.py`（LS 发现 + OAuth）、`chat_json.py`（消息格式）

## 快速启动

```bash
# 启动 API Server + Web IDE（自动发现所有 LS 实例）
python api_server.py --port 16601

# 浏览器访问
http://localhost:16601/

# CLI 直接 chat
python ag_core.py "say hello" --port 5490
```

## API 端点

### 核心对话
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat` | 对话（支持 conv_id 多轮、model 指定模型） |
| POST | `/v1/chat/completions` | OpenAI 兼容格式 |
| POST | `/v1/tasks` | 异步任务（立即返回 task_id） |
| GET | `/v1/tasks/{task_id}` | 查询任务状态 |

### 实例管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/health` | 健康检查 |
| GET | `/v1/instances` | 所有 LS 实例（含 display_name） |
| GET | `/v1/instances/{port}/status` | 实例详情 |
| GET | `/v1/instances/{port}/models` | 可用模型 |
| PUT | `/v1/instances/{port}/model` | 切换模型 |
| POST | `/v1/instances/refresh` | 刷新 LS 缓存 |
| GET | `/v1/instances/{port}/conversations` | 会话列表（按工作区过滤） |

### 工作区（只读）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/workspace/files?port=5490` | 文件树（排除 .git/node_modules 等） |
| GET | `/v1/workspace/file?path=xx&port=5490` | 读取文件内容（仅文本，≤2MB） |

### LS 原生代理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/ls/user-status` | 用户信息、套餐、配额 |
| GET | `/v1/ls/models` | 可用模型列表（含 quotaInfo） |
| POST | `/v1/ls/rpc/{method}` | 通用 LS RPC 代理 |

### 系统控制
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/system/info` | 获取系统硬件指标探针（CPU、内存、主屏幕分辨率等） |
| GET | `/v1/system/screenshot?title=Antigravity` | 精确截取屏幕/窗口截图（支持多屏幕自动适配与阴影裁边） |
| POST | `/v1/system/open-workspace` | 用 IDE 打开指定目录 |
| POST | `/v1/system/exec` | 执行命令（含超时保护） |

### 窗口管理（Win32 API）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/system/windows?title=X&process=Y` | 列出窗口（按标题+进程名过滤） |
| GET | `/v1/system/windows/{hwnd}` | 窗口详情（class_name、is_foreground） |
| POST | `/v1/system/windows/{hwnd}/action` | 窗口操作（底层已注入 Alt 键辅助解锁防断层技术） |
| POST | `/v1/system/auto-scroll` | 开启/关闭自动滚动守护 |
| GET | `/v1/system/auto-scroll` | 自动滚动状态查询 |

**窗口操作 action 值：**
| action | 参数 | 说明 |
|--------|------|------|
| `scroll` | `delta` | 发送 WM_MOUSEWHEEL（触发 Electron 重绘） |
| `focus` | — | 前置并强制聚焦（突破 Windows Foreground 限制） |
| `minimize` | — | 最小化 |
| `maximize` | — | 最大化 |
| `restore` | — | 还原 |
| `move` | `x`, `y` | 移动窗口 |
| `resize` | `width`, `height` | 调整大小 |
| `click` | `x`, `y` | 窗口内坐标点击 |

### 进程管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/system/processes?name=X&main_only=true` | 列出主进程，且自动映射返回其所属的底层可交互 UI 窗口 (`windows`)。**内建 5 秒 TTL 缓存层实现毫秒级响应**，可通过 `force_refresh=true` 击穿缓存。 |
| POST | `/v1/system/processes/{pid}/kill` | 终止进程 |

### 多级缓存架构

服务端内建多级缓存层，显著提升前端响应速度：

| 接口 | 缓存策略 | 说明 |
|------|---------|------|
| `/v1/system/processes` | 5 秒 TTL | 进程+窗口映射全量缓存，`force_refresh=true` 击穿 |
| `/v1/instances/{port}/conversations` | 增量式缓存 | 首次全量拉取，后续请求瞬间返回+后台异步增量刷新 |
| `/v1/ls/user-status` | 30 秒 TTL | 用户配额信息 |
| `/v1/ls/models` | 1 小时 TTL | 模型列表极少变动 |

**启动预热**：服务启动后 1 秒自动调用 `processes`、`system/info`、`instances` 三个重量级端点预热缓存，前端首次访问秒开。

## Mobile Web IDE

单页移动端 IDE，访问 `http://localhost:16601/`：

- **顶栏**：工作区选择器 + 模型切换下拉
- **会话管理**：新建对话、会话列表切换（增量缓存加速）
- **聊天**：AI 对话 + **Markdown 渲染**（marked.js）+ Action Tree 折叠渲染（自动过滤 retryable error）
- **📁 文件树**：浏览工作区文件 + 代码查看器（行号）
- **📷 截图**：窗口/全屏截图 + 刷新
- **>_ 终端**：远程命令执行
- **⚙️ 设置**：系统探针（真实物理分辨率）/用户配额/进程管理（单点终止）/紧急停止

## 自动滚动守护

解决 AG IDE Electron 渲染卡死导致自动确认插件失效的问题：

```python
# 开启（每 20 秒给 AG IDE 窗口发一次微滚动）
POST /v1/system/auto-scroll
{"enabled": true, "title_keyword": "Antigravity", "interval_seconds": 20}

# 查看状态
GET /v1/system/auto-scroll
# {"enabled": true, "scroll_count": 42, "last_scroll_time": "..."}

# 关闭
POST /v1/system/auto-scroll
{"enabled": false}
```

## 模型列表

通过 `GET /v1/ls/models` 动态获取（`clientModelConfigs`）：

| 显示名 | 内部代号 | 图片 |
|--------|---------|------|
| Gemini 3.1 Pro (High) | `MODEL_PLACEHOLDER_M37` | ✅ |
| Gemini 3.1 Pro (Low) | `MODEL_PLACEHOLDER_M36` | ✅ |
| Gemini 3 Flash | `MODEL_PLACEHOLDER_M47` | ✅ |
| Claude Sonnet 4.6 (Thinking) | `MODEL_PLACEHOLDER_M35` | ✅ |
| Claude Opus 4.6 (Thinking) | `MODEL_PLACEHOLDER_M26` | ✅ |
| GPT-OSS 120B (Medium) | `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` | ❌ |

## 多任务隔离（Baseline 切片）

同一个 `conv_id` 可连续发多个任务，每次 `chat()` 只返回**当前任务**的结果：

```
conv_id 已有 109 steps（旧任务）
    ↓
发送新消息前：记录 baseline = 109
    ↓
轮询时只分析 steps[109:]（新任务的 steps）
    ↓
返回新任务的 reply/milestones/retries
```

## 超时策略

| 参数 | 默认 | 说明 |
|------|------|------|
| `idle_timeout` | 60s | steps 无变化的最大等待 |
| `timeout` | 600s | 绝对上限 |

## 示例

```python
import httpx

# 简单对话
r = httpx.post("http://localhost:16601/v1/chat", json={
    "message": "say hello",
})
print(r.json()["reply"])

# 指定模型
r = httpx.post("http://localhost:16601/v1/chat", json={
    "message": "explain this code",
    "model": "MODEL_PLACEHOLDER_M37",
})

# 精确获取 7 个 AG IDE 窗口
r = httpx.get("http://localhost:16601/v1/system/windows", params={
    "title": "Antigravity", "process": "Antigravity.exe"
})
print(f"IDE 窗口数: {r.json()['count']}")  # 7

# 给窗口发滚动触发重绘
hwnd = r.json()["windows"][0]["hwnd"]
httpx.post(f"http://localhost:16601/v1/system/windows/{hwnd}/action",
           json={"action": "scroll", "delta": -1})
```

## 前端架构说明

`index.html` 采用**单文件单页应用**（约 1100 行 / 58KB），当前阶段不拆分，原因：

- **部署零配置**：`api_server.py` 仅 `StaticFiles` 挂载即可，无需构建工具
- **个人管控工具**：改动频率低，单文件可控
- **无构建依赖**：不依赖 Webpack / Vite，原生 JS 直接运行

**未来拆分阈值**（2000+ 行或多人协作时）：

```
index.html          ← 骨架 HTML
css/style.css       ← 样式
js/app.js           ← 状态管理 + 初始化
js/chat.js          ← 聊天收发逻辑
js/settings.js      ← 设置面板 + 系统监控
js/views.js         ← 文件树 / 终端 / 截图等视图
```

**模型列表适配**：`/v1/ls/models` 为纯透传接口（`rpc_call("GetCascadeModelConfigData")`），前端通过 `detectVendor()` 关键词分类器动态分组（Gemini → Claude → GPT → Other），无需随模型升级手动维护。

