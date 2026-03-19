# -*- coding: utf-8 -*-
"""
Antigravity API Server — FastAPI 封装 AntigravityCore。

启动:
    python api_server.py --port 8080 --ls-port 5490
    python api_server.py --port 8080  # 自动发现 LS

端点:
    POST /v1/chat                     — 对话
    POST /v1/chat/completions         — OpenAI 兼容
    POST /v1/tasks                    — 异步任务
    GET  /v1/tasks/{task_id}          — 查询任务
    GET  /v1/health                   — 健康检查
    GET  /v1/instances                — LS 实例列表
    GET  /v1/instances/{port}/status  — LS 详细状态
    GET  /v1/instances/{port}/models  — 可用模型
    PUT  /v1/instances/{port}/model   — 切换模型
    POST /v1/instances/refresh        — 刷新 LS 缓存
    GET  /v1/instances/{port}/conversations — 已有会话
"""
import argparse
import asyncio
import os
import sys
import time
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

# 添加路径
_DIR = os.path.dirname(__file__)
_PARENT = os.path.join(_DIR, "..")
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)

from ag_core import AntigravityCore, ChatResult

# ─── App ─────────────────────────────────────────────────────

app = FastAPI(title="Antigravity API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# 全局核心实例（按 port 缓存）
_cores: dict[int, AntigravityCore] = {}
_tasks: dict[str, dict] = {}  # task_id -> {status, result, ...}
_default_port: int = 0


@app.on_event("startup")
async def _warmup_caches():
    """服务启动后立刻在后台预热重量级缓存，让前端首次访问秒开"""
    async def _do_warmup():
        await asyncio.sleep(1)  # 等 uvicorn 完全就绪
        import httpx
        base = "http://127.0.0.1:16601"
        warmup_endpoints = [
            "/v1/system/processes?main_only=true",  # 进程列表（最重）
            "/v1/system/info",                       # 系统硬件探针
            "/v1/instances",                         # LS 实例列表
        ]
        for ep in warmup_endpoints:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    await client.get(f"{base}{ep}")
            except Exception:
                pass
        print("  🔥 Warmup: 缓存预热完成 (processes + system_info + instances)")
    asyncio.ensure_future(_do_warmup())

def _force_foreground(user32, hwnd):
    """通过模拟 Alt 键合法绕过 Windows 前台锁定。"""
    user32.keybd_event(0x12, 0, 0x0001, 0)
    user32.keybd_event(0x12, 0, 0x0001 | 0x0002, 0)
    ok = user32.SetForegroundWindow(hwnd)
    if not ok:
        user32.BringWindowToTop(hwnd)
        user32.ShowWindow(hwnd, 5) # SW_SHOW

def _get_core(port: int = None) -> AntigravityCore:

    p = port or _default_port
    if p not in _cores:
        _cores[p] = AntigravityCore(port=p if p else None)
    return _cores[p]


# ─── Request/Response Models ─────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    conv_id: Optional[str] = None
    timeout: float = 600.0
    idle_timeout: float = 60.0
    model: Optional[str] = None
    port: Optional[int] = None

class ChatCompletionRequest(BaseModel):
    model: str = "antigravity"
    messages: list[dict]
    stream: bool = False
    port: Optional[int] = None
    timeout: float = 300.0

class TaskRequest(BaseModel):
    prompt: str
    port: Optional[int] = None
    timeout: float = 300.0

class ModelSwitchRequest(BaseModel):
    model: str


# ─── Core Endpoints ──────────────────────────────────────────

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(_DIR, "index.html"))

@app.post("/v1/chat")
async def chat(req: ChatRequest):
    core = _get_core(req.port)
    result = await core.chat(req.message, conv_id=req.conv_id,
                              timeout=req.timeout, idle_timeout=req.idle_timeout,
                              model=req.model)
    from dataclasses import asdict
    return {
        "conv_id": result.conv_id,
        "reply": result.reply,
        "thinking": result.thinking,
        "actions": [asdict(a) if hasattr(a, '__dataclass_fields__') else a for a in result.actions],
        "milestones": result.milestones,
        "retries": result.retries,
        "steps_count": result.steps_count,
        "elapsed": round(result.elapsed, 2),
        "error": result.error or None,
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    # 提取最后一条用户消息
    user_msg = ""
    for m in reversed(req.messages):
        if m.get("role") == "user":
            user_msg = m.get("content", "")
            break
    if not user_msg:
        raise HTTPException(400, "No user message found")

    core = _get_core(req.port)
    result = await core.chat(user_msg, timeout=req.timeout)

    return {
        "id": "chatcmpl-%s" % uuid.uuid4().hex[:12],
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": result.reply},
            "finish_reason": "stop" if not result.error else "error",
        }],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }


@app.post("/v1/tasks", status_code=202)
async def create_task(req: TaskRequest):
    task_id = str(uuid.uuid4())
    core = _get_core(req.port)

    # 先 StartCascade 获取 conv_id
    import httpx
    async with httpx.AsyncClient(verify=False, http2=True, timeout=10.0) as client:
        conv_id = await core._start_cascade(client)

    _tasks[task_id] = {
        "status": "running",
        "conv_id": conv_id,
        "port": req.port or _default_port,
        "created_at": time.time(),
        "result": None,
    }

    # 后台执行
    asyncio.create_task(_run_task(task_id, core, req.prompt, conv_id, req.timeout))

    return {
        "task_id": task_id,
        "status": "running",
        "conv_id": conv_id,
    }


async def _run_task(task_id: str, core: AntigravityCore,
                    prompt: str, conv_id: str, timeout: float):
    try:
        result = await core.chat(prompt, conv_id=conv_id, timeout=timeout)
        _tasks[task_id]["status"] = "completed" if not result.error else "failed"
        _tasks[task_id]["result"] = {
            "reply": result.reply,
            "thinking": result.thinking,
            "actions": result.actions,
            "milestones": result.milestones,
            "retries": result.retries,
            "steps_count": result.steps_count,
            "elapsed": round(result.elapsed, 2),
            "error": result.error or None,
        }
    except Exception as e:
        _tasks[task_id]["status"] = "failed"
        _tasks[task_id]["result"] = {"error": str(e)}


@app.get("/v1/tasks/{task_id}")
async def get_task(task_id: str):
    if task_id not in _tasks:
        raise HTTPException(404, "Task not found")
    t = _tasks[task_id]
    return {
        "task_id": task_id,
        "status": t["status"],
        "conv_id": t["conv_id"],
        "result": t["result"],
    }


# ─── Management Endpoints ────────────────────────────────────

@app.get("/v1/health")
async def health():
    try:
        core = _get_core()
        return {
            "status": "ok",
            "ls_count": len(core.get_instances()),
            "version": "0.1.0",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/v1/instances")
async def list_instances():
    core = _get_core()
    instances = core.get_instances()
    for inst in instances:
        ws = inst.get("workspace", "")
        inst["display_name"] = _decode_workspace_name(ws)
    return {"count": len(instances), "instances": instances}


def _decode_workspace_name(ws: str) -> str:
    """将 workspace_id 解码为人类可读的项目名称。
    
    workspace_id 格式: file_c_3A_Malong_code_..._project_name
    编码规则: 所有的斜杠、连字符、%20(空格) 等都会被转成下划线(或 _20)。
    方案: 先还原盘符，再从右往左贪心匹配真实路径，使用模糊匹配忽略特殊字符差异。
    """
    if not ws:
        return "Unknown"
    # 非标准格式则直接返回
    if not ws.startswith("file_") or "_3A_" not in ws:
        return ws.split("_")[-1] if "_" in ws else ws

    import re, os
    # 步骤1: 提取盘符和路径段
    # file_c_3A_Malong_code_... → drive=c, rest=Malong_code_...
    m = re.match(r'^file_([a-zA-Z])_3A_(.*)', ws)
    if not m:
        return ws
    drive = m.group(1)
    rest = m.group(2)
    segments = rest.split('_')  # 每个下划线可能是分隔符或目录名的一部分

    # 步骤2: 从左到右贪心合并，用 os.listdir 模糊匹配真实目录名
    root = f"{drive}:\\"
    path_parts = []
    i = 0
    while i < len(segments):
        found = False
        for j in range(len(segments), i, -1):  # 贪心尽量长匹配
            candidate_raw = "_".join(segments[i:j])
            candidate_space = candidate_raw.replace("_20", " ")
            
            parent_dir = os.path.join(root, *path_parts)
            matched_name = None
            if os.path.exists(parent_dir):
                try:
                    entries = os.listdir(parent_dir)
                    # 1. 精确匹配
                    if candidate_raw in entries:
                        matched_name = candidate_raw
                    elif candidate_space in entries:
                        matched_name = candidate_space
                    else:
                        # 2. 模糊匹配: 忽略 _, -, 空格, _20
                        def normalize(s):
                            return s.lower().replace("_20", "").replace("_", "").replace("-", "").replace(" ", "")
                        target_norm = normalize(candidate_raw)
                        for name in entries:
                            if normalize(name) == target_norm:
                                matched_name = name
                                break
                except Exception:
                    pass
            
            if matched_name:
                path_parts.append(matched_name)
                i = j
                found = True
                break
                
        if not found:
            # 无法验证，单独作为一段
            path_parts.append(segments[i])
            i += 1

    if path_parts:
        return path_parts[-1]
    return segments[-1] if segments else ws


@app.get("/v1/instances/{port}/status")
async def instance_status(port: int):
    try:
        core = _get_core(port)
        return {
            "port": core.port,
            "workspace": core.workspace,
            "current_model": core._current_model,
        }
    except Exception as e:
        raise HTTPException(404, str(e))


@app.get("/v1/instances/{port}/models")
async def list_models(port: int):
    core = _get_core(port)
    # GetCommandModelConfigs 返回 proto，暂时返回当前模型
    return {
        "models": [
            {"id": "MODEL_PLACEHOLDER_M26", "name": "Gemini Model M26"},
        ],
        "current": core._current_model,
    }


@app.put("/v1/instances/{port}/model")
async def switch_model(port: int, req: ModelSwitchRequest):
    core = _get_core(port)
    prev = core.set_model(req.model)
    return {"success": True, "previous": prev, "current": req.model}


@app.post("/v1/instances/refresh")
async def refresh_instances():
    core = _get_core()
    result = core.refresh_instances()
    # 清除缓存的 core 实例
    _cores.clear()
    return result


# 会话列表增量缓存：首次全量拉取后只合并新增/更新的条目
_conv_cache = {}  # key=port, value={"timestamp": float, "data": {id: conv_dict}}


def _parse_conversations(summaries: dict, ws_path: str) -> list:
    """从 RPC 返回的 summaries 解析过滤出当前工作区的会话"""
    conversations = []
    for cascade_id, s in summaries.items():
        workspaces = s.get("workspaces") or s.get("trajectoryMetadata", {}).get("workspaces", [])
        matched = False
        for ws in workspaces:
            uri = ws.get("workspaceFolderAbsoluteUri", "")
            uri_path = uri.replace("file:///", "").replace("%20", " ").lower()
            if uri_path and ws_path and uri_path.rstrip("/") == ws_path.rstrip("/"):
                matched = True
                break
        if not matched:
            continue
        conversations.append({
            "id": cascade_id,
            "summary": s.get("summary", ""),
            "step_count": s.get("stepCount", 0),
            "status": s.get("status", ""),
            "created_time": s.get("createdTime", ""),
            "last_modified_time": s.get("lastModifiedTime", ""),
        })
    return conversations


@app.get("/v1/instances/{port}/conversations")
async def list_conversations(port: int):
    """列出指定工作区下的所有会话（增量缓存：首次全量，后续合并新增）"""
    core = _get_core(port)
    cache = _conv_cache.get(port)

    # 有缓存 → 直接返回缓存，后台静默刷新
    if cache and cache["data"]:
        result = sorted(cache["data"].values(), key=lambda c: c["last_modified_time"], reverse=True)
        # 异步增量刷新（不阻塞当前请求）
        asyncio.ensure_future(_refresh_conversations(port, core))
        return {"conversations": result, "count": len(result), "cached": True}

    # 无缓存 → 全量拉取
    try:
        data = await core.rpc_call("GetAllCascadeTrajectories")
        summaries = data.get("trajectorySummaries", {})
        ws_path = core.workspace_path.replace("\\", "/").lower()
        convs = _parse_conversations(summaries, ws_path)
        _conv_cache[port] = {"timestamp": time.time(), "data": {c["id"]: c for c in convs}}
        convs.sort(key=lambda c: c["last_modified_time"], reverse=True)
        return {"conversations": convs, "count": len(convs), "cached": False}
    except Exception as e:
        raise HTTPException(500, str(e))


async def _refresh_conversations(port: int, core):
    """后台增量刷新会话缓存（不阻塞前端请求）"""
    try:
        data = await core.rpc_call("GetAllCascadeTrajectories")
        summaries = data.get("trajectorySummaries", {})
        ws_path = core.workspace_path.replace("\\", "/").lower()
        new_convs = _parse_conversations(summaries, ws_path)
        cache = _conv_cache.get(port, {"timestamp": 0, "data": {}})
        for c in new_convs:
            cache["data"][c["id"]] = c  # 更新或新增
        cache["timestamp"] = time.time()
        _conv_cache[port] = cache
    except Exception:
        pass


# ─── Workspace Read-Only Endpoints ───────────────────────────

_IGNORE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv",
                ".idea", ".vscode", ".DS_Store", "dist", "build"}
_MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB


def _walk_tree(root: str, rel: str = "", depth: int = 0, max_depth: int = 5) -> list:
    """递归遍历目录，返回精简的树结构"""
    if depth > max_depth:
        return []
    current = os.path.join(root, rel) if rel else root
    items = []
    try:
        for name in sorted(os.listdir(current)):
            if name in _IGNORE_DIRS or name.startswith("."):
                continue
            full = os.path.join(current, name)
            child_rel = os.path.join(rel, name) if rel else name
            if os.path.isdir(full):
                children = _walk_tree(root, child_rel, depth + 1, max_depth)
                items.append({"name": name, "path": child_rel.replace("\\", "/"),
                              "type": "dir", "children": children})
            else:
                size = os.path.getsize(full)
                items.append({"name": name, "path": child_rel.replace("\\", "/"),
                              "type": "file", "size": size})
    except PermissionError:
        pass
    return items


@app.get("/v1/workspace/files")
async def workspace_files(port: int = None, max_depth: int = 4):
    """只读：列出工作区文件树"""
    core = _get_core(port)
    ws_path = core.workspace_path
    if not ws_path or not os.path.isdir(ws_path):
        raise HTTPException(404, f"工作区路径无效: {ws_path}")
    tree = _walk_tree(ws_path, max_depth=max_depth)
    return {"workspace": ws_path, "tree": tree}


@app.get("/v1/workspace/file")
async def workspace_file(path: str, port: int = None):
    """只读：读取单个文件内容"""
    core = _get_core(port)
    ws_path = core.workspace_path
    if not ws_path or not os.path.isdir(ws_path):
        raise HTTPException(404, f"工作区路径无效: {ws_path}")

    # 安全校验：防止目录遍历
    full = os.path.normpath(os.path.join(ws_path, path))
    if not full.startswith(ws_path):
        raise HTTPException(403, "路径越界")
    if not os.path.isfile(full):
        raise HTTPException(404, f"文件不存在: {path}")
    if os.path.getsize(full) > _MAX_FILE_SIZE:
        raise HTTPException(413, f"文件过大 (>{_MAX_FILE_SIZE // 1024}KB)")

    # 尝试读取文本
    try:
        with open(full, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        raise HTTPException(415, "非文本文件，无法读取")

    ext = os.path.splitext(path)[1].lstrip(".")
    return {"path": path, "content": content, "size": len(content),
            "extension": ext}


# ─── Cancel / Stop Cascade ───────────────────────────────────

@app.post("/v1/instances/{port}/cancel")
async def cancel_cascade(port: int):
    """远程停止 AI 会话：依次尝试 CancelCascadeSteps 和 CancelCascadeInvocation"""
    core = _get_core(port)
    results = {}
    for method in ["CancelCascadeSteps", "CancelCascadeInvocation"]:
        try:
            resp = await core.rpc_call(method, {})
            results[method] = {"ok": True, "response": resp}
        except Exception as e:
            results[method] = {"ok": False, "error": str(e)}
    return {"port": port, "results": results}


# ─── Chat History Storage (跨设备一致性) ─────────────────────

import json as _json
import datetime

_HISTORY_DIR = os.path.join(_DIR, "chat_history")
os.makedirs(_HISTORY_DIR, exist_ok=True)


def _history_path(cascade_id: str) -> str:
    # 防止路径注入
    safe = "".join(c for c in cascade_id if c.isalnum() or c in "-_")
    return os.path.join(_HISTORY_DIR, f"{safe}.json")


class ChatHistorySaveRequest(BaseModel):
    cascade_id: str
    messages: list[dict]  # [{role, content, timestamp?, actions?}]
    port: Optional[int] = None


@app.post("/v1/chat/history/{cascade_id}")
async def save_chat_history(cascade_id: str, req: ChatHistorySaveRequest):
    """保存聊天记录到本地（前端归档调用）"""
    path = _history_path(cascade_id)
    existing = []
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = _json.load(f).get("messages", [])
        except Exception:
            pass

    # 合并：追加新消息（按内容去重）
    existing_set = {(m.get("role", ""), m.get("content", "")[:100]) for m in existing}
    for m in req.messages:
        key = (m.get("role", ""), m.get("content", "")[:100])
        if key not in existing_set:
            existing.append(m)
            existing_set.add(key)

    record = {
        "cascade_id": cascade_id,
        "updated_at": datetime.datetime.now().isoformat(),
        "message_count": len(existing),
        "messages": existing,
    }
    with open(path, "w", encoding="utf-8") as f:
        _json.dump(record, f, ensure_ascii=False, indent=2)

    return {"ok": True, "cascade_id": cascade_id, "message_count": len(existing)}


@app.get("/v1/chat/history/{cascade_id}")
async def get_chat_history(cascade_id: str):
    """读取聊天记录（任意设备都可调用）"""
    path = _history_path(cascade_id)
    if not os.path.exists(path):
        return {"cascade_id": cascade_id, "found": False, "messages": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        return {"cascade_id": cascade_id, "found": True, **data}
    except Exception as e:
        return {"cascade_id": cascade_id, "found": False, "error": str(e), "messages": []}


@app.get("/v1/chat/history")
async def list_chat_histories():
    """列出所有已缓存的聊天记录摘要"""
    results = []
    for fname in os.listdir(_HISTORY_DIR):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(_HISTORY_DIR, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = _json.load(f)
            results.append({
                "cascade_id": data.get("cascade_id", fname[:-5]),
                "message_count": data.get("message_count", 0),
                "updated_at": data.get("updated_at", ""),
            })
        except Exception:
            continue
    results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return {"count": len(results), "histories": results}


@app.get("/v1/chat/history/{cascade_id}/timeline")
async def get_chat_timeline(cascade_id: str, port: int = None):
    """获取会话足迹时间线（从 LS 的 Steps 数据中提取）"""
    STEP_ICONS = {
        "CORTEX_STEP_TYPE_USER_INPUT": ("💬", "用户输入"),
        "CORTEX_STEP_TYPE_PLANNER_RESPONSE": ("🤖", "AI 回复"),
        "CORTEX_STEP_TYPE_CODE_ACTION": ("📝", "代码编辑"),
        "CORTEX_STEP_TYPE_RUN_COMMAND": ("📜", "执行命令"),
        "CORTEX_STEP_TYPE_LIST_DIRECTORY": ("📁", "浏览目录"),
        "CORTEX_STEP_TYPE_FIND": ("🔍", "搜索文件"),
        "CORTEX_STEP_TYPE_GREP_SEARCH": ("🔎", "文本搜索"),
        "CORTEX_STEP_TYPE_SEARCH_WEB": ("🌐", "网页搜索"),
        "CORTEX_STEP_TYPE_READ_URL_CONTENT": ("📰", "读取网页"),
        "CORTEX_STEP_TYPE_TASK_BOUNDARY": ("📌", "任务边界"),
        "CORTEX_STEP_TYPE_CHECKPOINT": ("💾", "检查点"),
        "CORTEX_STEP_TYPE_VIEW_CODE_ITEM": ("👁️", "查看代码"),
        "CORTEX_STEP_TYPE_COMMAND_STATUS": ("⏳", "命令状态"),
        "CORTEX_STEP_TYPE_READ_TERMINAL": ("🖥️", "读取终端"),
        "CORTEX_STEP_TYPE_MCP_TOOL": ("🔧", "MCP 工具"),
        "CORTEX_STEP_TYPE_NOTIFY_USER": ("📢", "通知用户"),
        "CORTEX_STEP_TYPE_BROWSER_SUBAGENT": ("🌐", "浏览器代理"),
        "CORTEX_STEP_TYPE_GENERATE_IMAGE": ("🖼️", "生成图片"),
    }

    core = _get_core(port)
    try:
        resp = await core.rpc_call("GetCascadeTrajectorySteps", {"cascadeId": cascade_id})
    except Exception as e:
        return {"cascade_id": cascade_id, "error": str(e), "timeline": []}

    steps = resp.get("steps", [])
    timeline = []
    for step in steps:
        stype = step.get("type", "")
        meta = step.get("metadata", {})
        ts = meta.get("createdAt", "")

        icon, label = STEP_ICONS.get(stype, ("⚙️", stype.replace("CORTEX_STEP_TYPE_", "")))

        # 尝试提取更多信息
        detail = ""
        tool_call = meta.get("toolCall", {})
        if tool_call.get("name"):
            detail = tool_call["name"]
        args_json = tool_call.get("argumentsJson", "")
        if args_json:
            try:
                args = _json.loads(args_json)
                if "CommandLine" in args:
                    detail = args["CommandLine"][:60]
                elif "AbsolutePath" in args:
                    detail = os.path.basename(args["AbsolutePath"])
                elif "TaskName" in args:
                    detail = args["TaskName"]
                elif "Query" in args:
                    detail = args["Query"][:40]
            except Exception:
                pass

        # 只保留有意义的步骤（跳过太密集的 checkpoint）
        if stype == "CORTEX_STEP_TYPE_CHECKPOINT" and not detail:
            continue

        timeline.append({
            "time": ts,
            "icon": icon,
            "label": label,
            "detail": detail,
            "type": stype,
        })

    return {"cascade_id": cascade_id, "total_steps": len(steps), "timeline": timeline}


# ─── LS Native RPC Proxy Endpoints ───────────────────────────

# 用户配额缓存 (30秒 TTL)
_user_status_cache = {"timestamp": 0, "port": None, "data": None}

@app.get("/v1/ls/user-status")
async def ls_user_status(port: int = None):
    """代理 LS 原生接口：获取用户状态（30 秒 TTL 缓存）"""
    global _user_status_cache
    now = time.time()
    if _user_status_cache["data"] and _user_status_cache["port"] == port and (now - _user_status_cache["timestamp"] < 30):
        return _user_status_cache["data"]
    core = _get_core(port)
    data = await core.rpc_call("GetUserStatus")
    _user_status_cache = {"timestamp": now, "port": port, "data": data}
    return data


# 模型列表缓存 (1 小时 TTL)
_models_cache = {"timestamp": 0, "port": None, "data": None}

@app.get("/v1/ls/models")
async def ls_models(port: int = None):
    """代理 LS 原生接口：获取可用模型列表（1 小时 TTL 缓存）"""
    global _models_cache
    now = time.time()
    if _models_cache["data"] and _models_cache["port"] == port and (now - _models_cache["timestamp"] < 3600):
        return _models_cache["data"]
    core = _get_core(port)
    data = await core.rpc_call("GetCascadeModelConfigData")
    _models_cache = {"timestamp": now, "port": port, "data": data}
    return data


@app.post("/v1/ls/rpc/{method}")
async def ls_rpc_proxy(method: str, body: dict = None, port: int = None):
    """通用 LS RPC 代理：调用任意 LanguageServerService 方法"""
    core = _get_core(port)
    return await core.rpc_call(method, body or {})


# ─── System-Level Endpoints ──────────────────────────────────

import base64
import subprocess
import io


class ExecRequest(BaseModel):
    command: str
    cwd: Optional[str] = None
    port: Optional[int] = None  # 用于推断 cwd（使用 workspace_path）
    timeout: float = 30.0


@app.get("/v1/system/screenshot")
async def system_screenshot(title: str = None, mode: str = "window", quality: int = 60):
    """
    截屏模式：
    - window: 截取并聚焦指定 title 的窗口
    - full: 最大化指定 title 的窗口，并截取它所在的物理屏
    - all: 截取拼接的所有物理显示器全景
    - screen_0, screen_1...: 截取指定索引的纯净物理显示器
    """
    try:
        import mss
        from PIL import Image
    except ImportError:
        raise HTTPException(500, "需要安装 mss 和 Pillow: pip install mss Pillow")

    import io
    import time

    def _mss_to_pil(sct_img):
        return Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")

    sct = mss.mss()

    if mode == "all":
        img = _mss_to_pil(sct.grab(sct.monitors[0]))
    elif mode.startswith("screen_"):
        try:
            screen_idx = int(mode.split("_")[1])
            # mss.monitors[0] 是虚拟全栈拼接，1 开始是各个物理屏幕
            if screen_idx + 1 < len(sct.monitors):
                img = _mss_to_pil(sct.grab(sct.monitors[screen_idx + 1]))
            else:
                img = _mss_to_pil(sct.grab(sct.monitors[0]))
        except Exception as e:
            print("Capture screen index error:", e)
            img = _mss_to_pil(sct.grab(sct.monitors[0]))
    elif title:
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            dwmapi = ctypes.windll.dwmapi

            def _find_window(keyword):
                results = []
                def cb(hwnd, _):
                    if not user32.IsWindowVisible(hwnd):
                        return True
                    ex_style = user32.GetWindowLongW(hwnd, -20)
                    if ex_style & 0x00000080:
                        return True
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length == 0:
                        return True
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    wnd_title = buf.value
                    if not wnd_title or keyword.lower() not in wnd_title.lower():
                        return True
                    
                    rect = wintypes.RECT()
                    DWMWA_EXTENDED_FRAME_BOUNDS = 9
                    res = dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(rect), ctypes.sizeof(rect))
                    if res != 0:
                        user32.GetWindowRect(hwnd, ctypes.byref(rect))
                    w = rect.right - rect.left
                    h = rect.bottom - rect.top
                    
                    if w > 0 and h > 0:
                        results.append((hwnd, wnd_title, rect))
                    return True

                WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
                user32.EnumWindows(WNDENUMPROC(cb), 0)
                return results

            windows = _find_window(title)
            if windows:
                hwnd, wnd_title, rect = windows[0]
                
                w = rect.right - rect.left
                h = rect.bottom - rect.top
                if user32.IsIconic(hwnd) or w <= 0 or h <= 0:
                    SW_RESTORE = 9
                    user32.ShowWindow(hwnd, SW_RESTORE)
                    _force_foreground(user32, hwnd)
                    time.sleep(0.5)

                if mode == "full":
                    SW_MAXIMIZE = 3
                    user32.ShowWindow(hwnd, SW_MAXIMIZE)
                    _force_foreground(user32, hwnd)
                    time.sleep(0.5)
                    
                    # 获取窗口所在的显示器边界，实现只截取这一个屏幕
                    MONITOR_DEFAULTTONEAREST = 2
                    hmon = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
                    class MONITORINFO(ctypes.Structure):
                        _fields_ = [
                            ("cbSize", wintypes.DWORD),
                            ("rcMonitor", wintypes.RECT),
                            ("rcWork", wintypes.RECT),
                            ("dwFlags", wintypes.DWORD)
                        ]
                    mi = MONITORINFO()
                    mi.cbSize = ctypes.sizeof(MONITORINFO)
                    if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
                        m_rect = mi.rcMonitor
                        bbox = {"left": m_rect.left, "top": m_rect.top, "width": m_rect.right - m_rect.left, "height": m_rect.bottom - m_rect.top}
                        try:
                            img = _mss_to_pil(sct.grab(bbox))
                        except Exception:
                            img = _mss_to_pil(sct.grab(sct.monitors[0]))
                    else:
                        img = _mss_to_pil(sct.grab(sct.monitors[0]))
                else:
                    user32.ShowWindow(hwnd, 9)
                    _force_foreground(user32, hwnd)
                    time.sleep(0.3)
                    
                    DWMWA_EXTENDED_FRAME_BOUNDS = 9
                    res = dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(rect), ctypes.sizeof(rect))
                    if res != 0:
                        user32.GetWindowRect(hwnd, ctypes.byref(rect))
                        
                    w = rect.right - rect.left
                    h = rect.bottom - rect.top
                    if w <= 0 or h <= 0 or rect.left < -10000:
                        img = _mss_to_pil(sct.grab(sct.monitors[0]))
                    else:
                        bbox = {"left": rect.left, "top": rect.top, "width": w, "height": h}
                        try:
                            img = _mss_to_pil(sct.grab(bbox))
                        except Exception:
                            img = _mss_to_pil(sct.grab(sct.monitors[0]))
            else:
                img = _mss_to_pil(sct.grab(sct.monitors[0]))
        except Exception as e:
            print("Window capture error:", e)
            img = _mss_to_pil(sct.grab(sct.monitors[0]))
    else:
        img = _mss_to_pil(sct.grab(sct.monitors[0]))

    if sct:
        sct.close()

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"image": b64, "width": img.width, "height": img.height,
            "format": "jpeg", "size": len(buf.getvalue())}


@app.post("/v1/system/open-workspace")
async def system_open_workspace(path: str):
    """用 Antigravity IDE 打开指定目录"""
    norm = os.path.normpath(path)
    if not os.path.isdir(norm):
        raise HTTPException(404, f"目录不存在: {norm}")
    try:
        # 尝试用 antigravity 命令打开
        subprocess.Popen(["antigravity", norm],
                         creationflags=subprocess.CREATE_NO_WINDOW)
        return {"success": True, "path": norm, "command": "antigravity"}
    except FileNotFoundError:
        # fallback 到 code 命令
        try:
            subprocess.Popen(["code", norm],
                             creationflags=subprocess.CREATE_NO_WINDOW)
            return {"success": True, "path": norm, "command": "code"}
        except FileNotFoundError:
            raise HTTPException(500, "未找到 antigravity 或 code 命令")


@app.post("/v1/system/exec")
async def system_exec(req: ExecRequest):
    """在工作区目录下执行命令，返回 stdout/stderr"""
    # 确定工作目录
    cwd = req.cwd
    if not cwd and req.port:
        try:
            core = _get_core(req.port)
            cwd = core.workspace_path
        except Exception:
            pass
    if not cwd:
        cwd = os.getcwd()

    try:
        result = subprocess.run(
            req.command, shell=True, cwd=cwd,
            capture_output=True, text=True,
            timeout=req.timeout,
        )
        # 截断过长输出
        max_out = 50_000
        stdout = result.stdout[:max_out]
        stderr = result.stderr[:max_out]
        return {
            "exit_code": result.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "cwd": cwd,
            "truncated": len(result.stdout) > max_out or len(result.stderr) > max_out,
        }
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": f"命令超时 ({req.timeout}s)",
                "cwd": cwd, "truncated": False}
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── Windows Window Management ───────────────────────────────

import ctypes
from ctypes import wintypes
import asyncio

# Win32 常量
WM_MOUSEWHEEL = 0x020A
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
SW_MINIMIZE = 6
SW_MAXIMIZE = 3
SW_RESTORE = 9
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
WHEEL_DELTA = 120

user32 = ctypes.windll.user32
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)


def _enum_windows(title_filter: str = None, process_filter: str = None) -> list:
    """枚举所有可见窗口，可按标题和进程名过滤"""
    results = []

    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        title = buf.value
        if not title:
            return True
        if title_filter and title_filter.lower() not in title.lower():
            return True
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        # 获取进程信息
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        proc_name = ""
        try:
            import psutil
            p = psutil.Process(pid.value)
            proc_name = p.name()
        except Exception:
            pass
        # 进程名过滤
        if process_filter and process_filter.lower() not in proc_name.lower():
            return True
        # 多显示器兼容：(-32000,-32000) 表示窗口已最小化
        is_minimized = rect.left <= -30000
        is_maximized = bool(user32.IsZoomed(hwnd))
        width = max(0, rect.right - rect.left) if not is_minimized else 0
        height = max(0, rect.bottom - rect.top) if not is_minimized else 0
        results.append({
            "hwnd": hwnd,
            "title": title,
            "pid": pid.value,
            "process_name": proc_name,
            "rect": {"left": rect.left, "top": rect.top,
                     "right": rect.right, "bottom": rect.bottom},
            "width": width,
            "height": height,
            "is_visible": True,
            "is_minimized": is_minimized,
            "is_maximized": is_maximized,
        })
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return results


@app.get("/v1/system/info")
async def system_info():
    """获取系统硬件和运行状态信息"""
    try:
        import psutil
        import socket
        import platform
        import ctypes
        
        mem = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=0.1)
        
        # 显示器信息 — 用原始字节缓冲直接读 DEVMODEW 固定偏移，获取真实物理分辨率
        try:
            buf = (ctypes.c_byte * 220)()
            ctypes.memmove(ctypes.addressof(buf) + 68, ctypes.byref(ctypes.c_ushort(220)), 2)
            ctypes.windll.user32.EnumDisplaySettingsW(None, -1, ctypes.byref(buf))
            w = ctypes.c_uint.from_buffer(buf, 172).value
            h = ctypes.c_uint.from_buffer(buf, 176).value
            
            # 获取物理显示器数量与每个显示器的边界
            from ctypes import wintypes
            monitors = []
            def _cb(hMonitor, hdcMonitor, lprcMonitor, dwData):
                r = lprcMonitor.contents
                monitors.append({"bbox": [r.left, r.top, r.right, r.bottom]})
                return True
            WINFUNCTYPE = ctypes.WINFUNCTYPE
            cb = WINFUNCTYPE(ctypes.c_bool, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
            cb_inst = cb(_cb)
            ctypes.windll.user32.EnumDisplayMonitors(0, 0, cb_inst, 0)
        except Exception as e:
            w = h = 0
            monitors = [{"bbox": [0, 0, 0, 0]}]

        return {
            "hostname": socket.gethostname(),
            "platform": platform.platform(),
            "cpu": {
                "percent": cpu_percent,
                "cores": psutil.cpu_count(logical=True),
            },
            "memory": {
                "total_gb": round(mem.total / (1024**3), 1),
                "used_gb": round(mem.used / (1024**3), 1),
                "percent": mem.percent,
            },
            "display": {
                "width": w,
                "height": h,
                "monitors": monitors,
                "count": len(monitors)
            }
        }
    except Exception as e:
        raise HTTPException(500, f"无法获取系统信息: {str(e)}")


@app.get("/v1/system/windows")
async def list_windows(title: str = None, process: str = None):
    """列出可见窗口。title=标题关键词, process=进程名关键词"""
    windows = _enum_windows(title, process)
    return {"windows": windows, "count": len(windows)}


@app.get("/v1/system/windows/{hwnd}")
async def get_window(hwnd: int):
    """获取指定窗口详情"""
    if not user32.IsWindow(hwnd):
        raise HTTPException(404, f"窗口句柄无效: {hwnd}")
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    cls_buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, cls_buf, 256)
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    fg = user32.GetForegroundWindow()
    proc_name = ""
    try:
        import psutil
        proc_name = psutil.Process(pid.value).name()
    except Exception:
        pass
    return {
        "hwnd": hwnd, "title": buf.value, "class_name": cls_buf.value,
        "pid": pid.value, "process_name": proc_name,
        "rect": {"left": rect.left, "top": rect.top,
                 "right": rect.right, "bottom": rect.bottom},
        "is_visible": bool(user32.IsWindowVisible(hwnd)),
        "is_foreground": hwnd == fg,
    }


class WindowActionRequest(BaseModel):
    action: str  # scroll, focus, minimize, maximize, restore, move, resize, click
    delta: Optional[int] = None    # scroll delta
    x: Optional[int] = None
    y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None


@app.post("/v1/system/windows/{hwnd}/action")
async def window_action(hwnd: int, req: WindowActionRequest):
    """对指定窗口执行操作"""
    if not user32.IsWindow(hwnd):
        raise HTTPException(404, f"窗口句柄无效: {hwnd}")

    action = req.action.lower()

    if action == "scroll":
        delta = (req.delta or -WHEEL_DELTA)
        # wParam: HIWORD=delta, LOWORD=0; lParam: 鼠标位置（窗口中心）
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        cx = (rect.left + rect.right) // 2
        cy = (rect.top + rect.bottom) // 2
        wparam = ctypes.c_uint((delta & 0xFFFF) << 16).value
        lparam = (cy << 16) | (cx & 0xFFFF)
        user32.SendMessageW(hwnd, WM_MOUSEWHEEL, wparam, lparam)
        return {"ok": True, "action": "scroll", "delta": delta}

    elif action == "focus":
        user32.ShowWindow(hwnd, SW_RESTORE)
        _force_foreground(user32, hwnd)
        return {"ok": True, "action": "focus"}

    elif action == "minimize":
        user32.ShowWindow(hwnd, SW_MINIMIZE)
        return {"ok": True, "action": "minimize"}

    elif action == "maximize":
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        return {"ok": True, "action": "maximize"}

    elif action == "restore":
        user32.ShowWindow(hwnd, SW_RESTORE)
        return {"ok": True, "action": "restore"}

    elif action == "move":
        if req.x is None or req.y is None:
            raise HTTPException(400, "move 需要 x, y 参数")
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        user32.MoveWindow(hwnd, req.x, req.y, w, h, True)
        return {"ok": True, "action": "move", "x": req.x, "y": req.y}

    elif action == "resize":
        if req.width is None or req.height is None:
            raise HTTPException(400, "resize 需要 width, height 参数")
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        user32.MoveWindow(hwnd, rect.left, rect.top, req.width, req.height, True)
        return {"ok": True, "action": "resize",
                "width": req.width, "height": req.height}

    elif action == "click":
        if req.x is None or req.y is None:
            raise HTTPException(400, "click 需要 x, y 参数（窗口内相对坐标）")
        lparam = (req.y << 16) | (req.x & 0xFFFF)
        user32.SendMessageW(hwnd, WM_LBUTTONDOWN, 0, lparam)
        user32.SendMessageW(hwnd, WM_LBUTTONUP, 0, lparam)
        return {"ok": True, "action": "click", "x": req.x, "y": req.y}

    else:
        raise HTTPException(400, f"不支持的操作: {action}")


# ─── 智能滚动守护（B+C 策略）────────────────────────────────
# B: 有"正在运行"会话的窗口 → 定时滚动
# C: 检测到会话从 running→idle → 延迟 5s 后补滚一次

_auto_scroll_state = {
    "enabled": False,
    "interval_seconds": 10,    # 状态检查间隔
    "scroll_interval": 20,     # B 策略：活跃窗口滚动间隔
    "completion_delay": 5,     # C 策略：完成后延迟滚动秒数
    "scroll_delta": -1,
    "last_scroll_time": None,
    "scroll_count": 0,
    "task": None,
    "log": [],                 # 最近操作日志（最多 50 条）
}

# 跟踪每个 workspace 上一次的会话状态
_prev_workspace_status = {}  # {workspace_name: {"active": bool, "step_count": int}}
# 跟踪每个窗口的上次滚动时间
_last_scroll_per_hwnd = {}   # {hwnd: timestamp}


def _scroll_window(hwnd: int, delta: int = -1):
    """发送微滚动到指定窗口"""
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    if rect.left <= -30000:  # 最小化的窗口跳过
        return False
    cx = (rect.left + rect.right) // 2
    cy = (rect.top + rect.bottom) // 2
    wparam = ctypes.c_uint((delta & 0xFFFF) << 16).value
    lparam = (cy << 16) | (cx & 0xFFFF)
    user32.SendMessageW(hwnd, WM_MOUSEWHEEL, wparam, lparam)
    return True


def _match_window_to_workspace(windows: list, workspace_name: str):
    """从窗口列表中找到标题包含 workspace_name 的窗口"""
    ws_lower = workspace_name.lower()
    for w in windows:
        # AG IDE 窗口标题格式: "workspace_name - Antigravity - ..."
        title_lower = w["title"].lower()
        if title_lower.startswith(ws_lower + " -") or ws_lower in title_lower:
            return w
    return None


async def _smart_scroll_loop():
    """智能滚动守护主循环（B+C 策略）"""
    import datetime, time, httpx

    # 内部计时
    last_b_scroll_time = 0  # 上次 B 策略滚动时间

    while _auto_scroll_state["enabled"]:
        try:
            now = time.time()
            now_iso = datetime.datetime.now().isoformat()

            # 1. 获取所有 AG IDE 窗口
            windows = _enum_windows("Antigravity", process_filter="Antigravity.exe")
            if not windows:
                await asyncio.sleep(_auto_scroll_state["interval_seconds"])
                continue

            # 2. 获取所有 LS 实例（通过 API 获取含 display_name 的数据）
            instances = []
            try:
                async with httpx.AsyncClient() as client:
                    api_port = _auto_scroll_state.get('_api_port', 16601)
                    r = await client.get(f"http://127.0.0.1:{api_port}/v1/instances", timeout=5.0)
                    instances = r.json().get("instances", [])
            except Exception:
                pass

            # 3. 对每个实例检查会话状态
            for inst in instances:
                port = inst.get("port")
                ws_name = inst.get("display_name") or ""
                if not port or not ws_name:
                    continue

                # 匹配窗口
                matched_win = _match_window_to_workspace(windows, ws_name)
                if not matched_win:
                    continue
                hwnd = matched_win["hwnd"]

                # 查询该实例的会话状态
                has_active = False
                total_steps = 0
                try:
                    async with httpx.AsyncClient() as client:
                        r = await client.get(
                            f"http://127.0.0.1:{_auto_scroll_state.get('_api_port', 16601)}"
                            f"/v1/instances/{port}/conversations",
                            timeout=5.0)
                        convs = r.json().get("conversations", [])
                        for c in convs:
                            status = c.get("status", "").lower()
                            total_steps += c.get("step_count", 0)
                            if status in ("running", "in_progress", "active", ""):
                                # 有最近活跃的会话
                                modified = c.get("last_modified_time", "")
                                if modified:
                                    # 检查是否最近 5 分钟内有修改
                                    try:
                                        from datetime import timezone
                                        mod_time = datetime.datetime.fromisoformat(
                                            modified.replace("Z", "+00:00"))
                                        age = (datetime.datetime.now(timezone.utc) - mod_time).total_seconds()
                                        if age < 300:  # 5 分钟内
                                            has_active = True
                                    except Exception:
                                        has_active = True
                except Exception:
                    continue

                prev = _prev_workspace_status.get(ws_name, {})
                prev_active = prev.get("active", False)
                prev_steps = prev.get("step_count", 0)

                # 更新状态
                _prev_workspace_status[ws_name] = {
                    "active": has_active, "step_count": total_steps
                }

                # --- 策略 C：running→idle 且 steps 增加了 → 延迟补滚 ---
                if prev_active and not has_active and total_steps > prev_steps:
                    _add_log(f"[C] {ws_name}: 会话完成 (steps {prev_steps}→{total_steps})，{_auto_scroll_state['completion_delay']}s 后补滚")
                    asyncio.create_task(
                        _delayed_scroll(hwnd, ws_name, _auto_scroll_state["completion_delay"])
                    )

                # --- 策略 B：活跃窗口定时滚 ---
                if has_active and (now - last_b_scroll_time) >= _auto_scroll_state["scroll_interval"]:
                    last_hwnd_time = _last_scroll_per_hwnd.get(hwnd, 0)
                    if (now - last_hwnd_time) >= _auto_scroll_state["scroll_interval"]:
                        if _scroll_window(hwnd, _auto_scroll_state["scroll_delta"]):
                            _last_scroll_per_hwnd[hwnd] = now
                            _auto_scroll_state["scroll_count"] += 1
                            _add_log(f"[B] {ws_name}: 活跃滚动 (hwnd={hwnd})")

            _auto_scroll_state["last_scroll_time"] = now_iso

        except Exception as e:
            _add_log(f"[ERROR] {e}")

        await asyncio.sleep(_auto_scroll_state["interval_seconds"])


async def _delayed_scroll(hwnd: int, ws_name: str, delay: float):
    """策略 C：延迟后补一次滚动"""
    await asyncio.sleep(delay)
    if _auto_scroll_state["enabled"]:
        if _scroll_window(hwnd, _auto_scroll_state["scroll_delta"]):
            _auto_scroll_state["scroll_count"] += 1
            _add_log(f"[C] {ws_name}: 延迟补滚完成 (hwnd={hwnd})")


def _add_log(msg: str):
    """添加日志条目"""
    import datetime
    entry = f"{datetime.datetime.now().strftime('%H:%M:%S')} {msg}"
    _auto_scroll_state["log"].append(entry)
    if len(_auto_scroll_state["log"]) > 50:
        _auto_scroll_state["log"] = _auto_scroll_state["log"][-50:]
    print(f"[AutoScroll] {entry}")


class AutoScrollRequest(BaseModel):
    enabled: bool = True
    interval_seconds: int = 10     # 状态检查间隔
    scroll_interval: int = 20      # B 策略滚动间隔
    completion_delay: int = 5      # C 策略完成后延迟
    scroll_delta: int = -1


@app.post("/v1/system/auto-scroll")
async def set_auto_scroll(req: AutoScrollRequest):
    """开启/关闭智能滚动守护（B+C 策略）"""
    # 停止现有任务
    if _auto_scroll_state["task"] and not _auto_scroll_state["task"].done():
        _auto_scroll_state["enabled"] = False
        _auto_scroll_state["task"].cancel()
        try:
            await _auto_scroll_state["task"]
        except (asyncio.CancelledError, Exception):
            pass

    _auto_scroll_state["enabled"] = req.enabled
    _auto_scroll_state["interval_seconds"] = max(5, req.interval_seconds)
    _auto_scroll_state["scroll_interval"] = max(10, req.scroll_interval)
    _auto_scroll_state["completion_delay"] = max(1, req.completion_delay)
    _auto_scroll_state["scroll_delta"] = req.scroll_delta
    _auto_scroll_state["_api_port"] = 16601  # 自引用端口

    if req.enabled:
        _auto_scroll_state["scroll_count"] = 0
        _auto_scroll_state["log"] = []
        _prev_workspace_status.clear()
        _last_scroll_per_hwnd.clear()
        _auto_scroll_state["task"] = asyncio.create_task(_smart_scroll_loop())
        status = "running"
        _add_log("守护启动 (B+C 策略)")
    else:
        _auto_scroll_state["task"] = None
        status = "stopped"

    return {
        "enabled": req.enabled, "status": status,
        "interval_seconds": _auto_scroll_state["interval_seconds"],
        "scroll_interval": _auto_scroll_state["scroll_interval"],
        "completion_delay": _auto_scroll_state["completion_delay"],
    }


@app.get("/v1/system/auto-scroll")
async def get_auto_scroll():
    """获取智能滚动守护状态"""
    return {
        "enabled": _auto_scroll_state["enabled"],
        "interval_seconds": _auto_scroll_state["interval_seconds"],
        "scroll_interval": _auto_scroll_state["scroll_interval"],
        "completion_delay": _auto_scroll_state["completion_delay"],
        "scroll_delta": _auto_scroll_state["scroll_delta"],
        "last_scroll_time": _auto_scroll_state["last_scroll_time"],
        "scroll_count": _auto_scroll_state["scroll_count"],
        "workspace_status": _prev_workspace_status,
        "log": _auto_scroll_state["log"][-20:],
    }


# ─── Process Management ──────────────────────────────────────

_process_cache = {
    "timestamp": 0,
    "data": None
}

@app.get("/v1/system/processes")
async def list_processes(name: str = None, main_only: bool = False, force_refresh: bool = False):
    """列出进程，可按名称过滤。main_only=true 仅返回主进程（排除 Electron 子进程）"""
    global _process_cache
    import psutil
    import ctypes
    import time
    from ctypes import wintypes
    
    now = time.time()
    
    # 若缓存失效或强制刷新，则重新扫描全部进程与窗体
    if force_refresh or not _process_cache["data"] or (now - _process_cache["timestamp"] >= 5.0):
        user32 = ctypes.windll.user32
        # 1. 收集系统中所有可见窗口与其 PID 的映射
        pid_windows = {}
        def _enum_cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value:
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buf = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buf, length + 1)
                        title = buf.value
                        if title:
                            pid_windows.setdefault(pid.value, []).append({"hwnd": hwnd, "title": title})
            return True
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows(WNDENUMPROC(_enum_cb), 0)

        # 2. 获取进程 (全量存入缓存)
        procs_all = []
        for p in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info']):
            try:
                info = p.info
                pname = info.get('name', '')
                cmd = ' '.join(info.get('cmdline') or [])
                is_child = '--type=' in cmd
                role = 'child' if is_child else 'main'
                mem = info.get('memory_info')
                
                procs_all.append({
                    "pid": info['pid'],
                    "name": pname,
                    "role": role,
                    "cmd_line": cmd[:200],
                    "memory_mb": round(mem.rss / (1024 * 1024), 1) if mem else 0,
                    "windows": pid_windows.get(info['pid'], [])
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
                
        procs_all.sort(key=lambda x: x['memory_mb'], reverse=True)
        _process_cache["data"] = procs_all
        _process_cache["timestamp"] = now

    # 3. 从缓存过滤返回
    res = []
    for p in _process_cache["data"]:
        if name and name.lower() not in p['name'].lower():
            continue
        if main_only and p['role'] == 'child':
            continue
        res.append(p)
        
    return {"processes": res[:100], "count": len(res)}


@app.post("/v1/system/processes/{pid}/kill")
async def kill_process(pid: int):
    """终止指定进程"""
    import psutil
    try:
        p = psutil.Process(pid)
        name = p.name()
        p.kill()
        return {"ok": True, "pid": pid, "name": name}
    except psutil.NoSuchProcess:
        raise HTTPException(404, f"进程不存在: {pid}")
    except psutil.AccessDenied:
        raise HTTPException(403, f"无权限终止进程: {pid}")


# ─── Main ────────────────────────────────────────────────────

def main():
    global _default_port
    parser = argparse.ArgumentParser(description="Antigravity API Server")
    parser.add_argument("--port", type=int, default=16601, help="API server port")
    parser.add_argument("--ls-port", type=int, default=0, help="Default LS port")
    args = parser.parse_args()

    _default_port = args.ls_port

    # 预初始化核心
    try:
        core = _get_core()
        print("Antigravity API Server v0.1.0")
        print("  API:  http://localhost:%d" % args.port)
        print("  LS:   port=%d (%s)" % (core.port, core.workspace))
        print("  Instances: %d" % len(core.get_instances()))
        print()
    except Exception as e:
        print("WARNING: %s" % e)

    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
