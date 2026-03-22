# Antigravity Mobile IDE

> **⚠️ Disclaimer**
>
> This project is for **educational and research purposes only**. Using this tool to interact with Antigravity IDE may violate Google's Terms of Service and could result in account suspension or termination. **Use at your own risk.**
>
> The project maintainers assume no responsibility for any consequences arising from the use of this tool (including but not limited to account bans, data loss, or service interruption).
>
> Licensed under [CC BY-NC-SA 4.0](LICENSE) — Non-Commercial, Attribution, ShareAlike.

[**English**](README_en.md) | [**中文**](README.md)

Python Backend + Modular Frontend, wrapping the conversational capabilities of the Antigravity Language Server to provide REST APIs + a Mobile Web IDE.

## 📸 Demo Screenshots

| AI Chat (Capabilities) | Image Attachment Recognition | Code Viewer |
|:---:|:---:|:---:|
| ![Chat](docs/screenshots/reply_content_with_photo.jpg) | ![Attachment](docs/screenshots/talk_with_picture.jpg) | ![Code](docs/screenshots/work_tree_view_file.jpg) |

| File Tree + Context Menu | Remote Terminal | Screenshot Viewer + Dashboard |
|:---:|:---:|:---:|
| ![File Tree](docs/screenshots/work_tree_function_panel.jpg) | ![Terminal](docs/screenshots/terminal_tool.jpg) | ![Screenshot](docs/screenshots/windows_screeshot.jpg) |

## ✨ Features

- 💬 **Multi-turn AI Chat** — Markdown rendering, Action Tree folding, dynamic multi-model switching.
- 📎 **Image Attachments** — Upload images or reference with `@file:path`, AI can visually recognize and reply.
- 📁 **File Tree Browser** — Lazy Loading hierarchies + `⋮` Context Menu (Copy Path, Reference to Chat).
- 🖥️ **Remote Terminal** — Command execution + output echo + history records.
- 📷 **Screenshot Viewer** — Multi-display auto-adaptation + real-time CPU/Memory dashboard.
- 🖼️ **Full-Screen Image Viewer** — Pinch-zoom, pan, double-tap to reset, long-press to download.
- ⚙️ **Settings Panel** — Model quota probe, process management, instance switching, emergency stop.
- 🔌 **OpenAI Compatible API** — `/v1/chat/completions`, allows integration with third-party tools.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start API Server + Web IDE (automatically discovers all LS instances)
python backend/api_server.py --port 16601

# Access via browser
http://localhost:16601/

# CLI Direct Chat
python backend/ag_core.py "say hello" --port 5490
```

## Project Structure

```
antigravity-mobile-ide/
├── frontend/                 # Frontend (ES Modules, no build tools required)
│   ├── index.html            # HTML Skeleton
│   ├── css/style.css         # Global Styles
│   └── js/
│       ├── app.js            # Entry point: imports modules, exposes global functions, init
│       ├── state.js          # State management + localStorage + SWR cache
│       ├── ui.js             # UI interactions: drawers/modals/message appending
│       ├── chat.js           # Chat logic: session switching, sending/receiving, AI response rendering
│       ├── instances.js      # Instance switching and state recovery
│       ├── models.js         # Model list fetching and selection
│       ├── screenshot.js     # Screenshot viewer + System dashboard
│       ├── file-tree.js      # File tree browsing + Code viewer
│       ├── terminal.js       # Remote command execution
│       ├── settings.js       # Settings panel
│       └── image-viewer.js   # Full-screen image viewer
├── backend/
│   ├── api_server.py         # FastAPI server (30+ REST endpoints + Static file serving)
│   ├── ag_core.py            # AntigravityCore Business Layer
│   └── steps_parser.py       # Steps JSON parser
├── data/
│   └── chat_history/         # Persistent chat history storage
├── temp/
│   └── upload_data/          # Temporary storage for image attachments
├── tests/                    # Test files
├── docs/                     # Screenshots & Design documentation
└── requirements.txt          # Python dependencies
```

## Deployment

### Mobile Access

The backend binds to `0.0.0.0`. You can access it directly via a mobile browser on the same local network:

```
http://<Computer-IP>:16601/
```

### 🔒 Secure Deployment: Using Tailscale

Because this project transmits plaintext via HTTP, directly exposing it to the public internet or untrusted Wi-Fi **poses security risks**. It is **highly recommended** to use [Tailscale](https://tailscale.com/) to establish an encrypted virtual local network:

```bash
# 1. Install Tailscale on both your computer and mobile device and log into the same account
# 2. Access via the internal IP assigned by Tailscale
http://100.x.x.x:16601/
```

Advantages: **End-to-End Encryption** (WireGuard tunnel) · **Zero Configuration** (No SSL / Port Forwarding needed) · **Cross-Network Access**.

### Recommended Plugins

[AntiGravity AutoAccept](https://github.com/yazanbaker94/AntiGravity-AutoAccept) (by YazanBaker) — Automatically accepts AI operation requests, eliminating manual confirmation overhead.

### Running in Background (Windows)

```powershell
# Start in background
Start-Process python -ArgumentList "backend/api_server.py","--port","16601" -WindowStyle Hidden

# View / Stop
netstat -ano | Select-String "16601.*LISTENING"
$pid = (netstat -ano | Select-String "16601.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -First 1)
Stop-Process -Id $pid -Force
```

## Architecture

```
Mobile Browser ──HTTP──→ api_server.py (:16601)
                        │
                        ├── Static File Service: frontend/ (HTML/CSS/JS)
                        ├── REST API: /v1/chat, /v1/system/*, ...
                        └── gRPC ──→ Antigravity Language Server (:5490, :8128, ...)
```

The backend is a single process functioning simultaneously as a **Static File Server + API Gateway + LS Proxy**, eliminating the need for extra components like Nginx.

### Multi-Level Caching

| Endpoint | Strategy | Description |
|------|------|------|
| `/v1/system/processes` | Background sync 30s | Startup warmup + background loop, requests never block |
| `/v1/instances/{port}/conversations` | Incremental | Full fetch initally, instant returns subsequently + incremental background refresh |
| `/v1/ls/user-status` | 30s TTL | User quota information |
| `/v1/ls/models` | 1h TTL | Model lists rarely change |

## API Endpoints

### Core Chat
| Method | Path | Description |
|------|------|------|
| POST | `/v1/chat` | Chat (Supports `conv_id` multi-turn, `model` specification) |
| POST | `/v1/chat/completions` | OpenAI compatible format |
| POST | `/v1/chat/upload-image` | Upload image attachments |
| POST | `/v1/instances/{port}/cancel` | Emergency stop AI execution |
| GET | `/v1/local-file?path=...` | Proxies local files (bypasses browser `file:///` restrictions) |
| GET/POST | `/v1/chat/history/{conv_id}` | Retrieve/Save chat history |

### Instance Management
| Method | Path | Description |
|------|------|------|
| GET | `/v1/health` | Health Check |
| GET | `/v1/instances` | All LS Instances |
| GET | `/v1/instances/{port}/status` | Instance Details |
| GET | `/v1/instances/{port}/models` | Available Models |
| PUT | `/v1/instances/{port}/model` | Switch Model |
| POST | `/v1/instances/refresh` | Refresh LS Cache |
| GET | `/v1/instances/{port}/conversations` | Conversation List |

### Workspace
| Method | Path | Description |
|------|------|------|
| GET | `/v1/workspace/files?port=5490` | File Tree |
| GET | `/v1/workspace/file?path=xx&port=5490` | Read File Content |

### System Control
| Method | Path | Description |
|------|------|------|
| GET | `/v1/system/info` | Hardware metrics probe |
| GET | `/v1/system/screenshot?title=...` | Precise Screenshot |
| POST | `/v1/system/exec` | Execute command |
| POST | `/v1/system/open-workspace` | Open directory with IDE |

### Window & Process Management
| Method | Path | Description |
|------|------|------|
| GET | `/v1/system/windows` | List windows |
| POST | `/v1/system/windows/{hwnd}/action` | Window operations |
| GET | `/v1/system/processes` | Process list (30s cache) |
| POST | `/v1/system/processes/{pid}/kill` | Terminate process |

## Examples

```python
import httpx

# Simple Chat
r = httpx.post("http://localhost:16601/v1/chat", json={
    "message": "say hello",
})
print(r.json()["reply"])

# Specify Model
r = httpx.post("http://localhost:16601/v1/chat", json={
    "message": "explain this code",
    "model": "MODEL_PLACEHOLDER_M37",  # Example: gemini-3.1-pro
})

# Get IDE Windows
r = httpx.get("http://localhost:16601/v1/system/windows", params={
    "title": "Antigravity", "process": "Antigravity.exe"
})
print(f"Num IDE Windows: {r.json()['count']}")
```

## Frontend Architecture

Uses **ES Modules**, with 11 JS files handling specific tasks, requiring absolutely no build tools (Webpack/Vite):

- `app.js` Imports all modules centrally, exposes them globally via `window.xxx = fn` for HTML `onclick`.
- `state.js` Implements stale-while-revalidate caching, ensuring "instant open" capabilities on the frontend.
- CSS is entirely centralized in `style.css`. JS `innerHTML` only uses semantic classes, making the code **friendly for parsing by LLMs**.

**Image Attachments**: Supports 📎 uploading or referencing via `@file:path`. The frontend automatically scans for image extensions, generates thumbnails, and persists them to chat history via proxy URLs.

**File Tree Menu**: The `⋮` context menu supports refreshing directories, copying paths, and `@file:` referencing to chat.

**Model Adaptation**: The frontend dynamically groups models (Gemini / Claude / GPT / Other) using a keyword classifier via `getVendor()`, eliminating the need for manual maintenance as models upgrade.
