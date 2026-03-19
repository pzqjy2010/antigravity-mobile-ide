# -*- coding: utf-8 -*-
"""
AntigravityCore — 核心业务层，封装「发消息 → 轮询 → 解析」完整流程。

用法:
    from ag_core import AntigravityCore
    core = AntigravityCore(port=5490)
    result = await core.chat("say hello")
    print(result.reply)
"""
import asyncio
import json
import os
import random
import sys
import time
import warnings
from dataclasses import dataclass, field
from typing import Optional

warnings.filterwarnings("ignore")
import httpx

# 添加父目录到 path，以便 import ls_connector
_PARENT = os.path.join(os.path.dirname(__file__), "..")
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from ls_connector import discover_ls_instances, get_oauth_token
from steps_parser import StepsParser


# ─── 数据结构 ────────────────────────────────────────────────

@dataclass
class ChatResult:
    conv_id: str = ""
    reply: str = ""
    thinking: Optional[str] = None
    actions: list = field(default_factory=list)
    milestones: list = field(default_factory=list)
    retries: int = 0
    steps_count: int = 0
    elapsed: float = 0.0
    error: str = ""
    raw_steps: list = field(default_factory=list)


# ─── 核心类 ──────────────────────────────────────────────────

class AntigravityCore:
    """封装与 Antigravity LS 的完整交互"""

    SVC = "exa.language_server_pb.LanguageServerService"

    def __init__(self, port: int = None):
        """初始化，自动发现 LS 并获取 OAuth。"""
        instances = discover_ls_instances()
        if not instances:
            raise RuntimeError("未找到任何 LS 实例")

        self._instance = None
        if port:
            for inst in instances:
                if inst.server_port == port:
                    self._instance = inst
                    break
            if not self._instance:
                raise RuntimeError(f"未找到 port={port} 的 LS 实例")
        else:
            self._instance = instances[0]

        self._oauth = get_oauth_token()
        if not self._oauth:
            raise RuntimeError("未找到 OAuth token")

        self._base_url = f"https://127.0.0.1:{self._instance.server_port}"
        self._csrf = self._instance.csrf_token
        self._current_model = "MODEL_PLACEHOLDER_M26"

        # LS 实例缓存
        self._instances_cache = instances

    @property
    def port(self) -> int:
        return self._instance.server_port

    @property
    def workspace(self) -> str:
        return getattr(self._instance, "workspace_id", "unknown")

    @property
    def workspace_path(self) -> str:
        """将 workspace_id 解码为真实文件系统路径。
        workspace_id 中 _ 既是路径分隔符也是文件名字符，
        通过贪心匹配文件系统来消除歧义。
        例: file_c_3A_Malong_code_Antigravity_trial_1_xxx
          → C:\\Malong\\code\\Antigravity\\trial_1\\xxx
        """
        ws = self.workspace
        if not ws.startswith("file_"):
            return ""
        encoded = ws[len("file_"):]
        encoded = encoded.replace("_3A_", ":/", 1)  # c_3A_ → c:/

        # 分离盘符和剩余部分
        parts = encoded.split("/", 1)
        if len(parts) != 2:
            return ""
        drive = parts[0].upper() + "\\"  # "C:\"
        tokens = parts[1].split("_")     # ["Malong","code","Antigravity","trial","1",...]

        # 贪心匹配：优先尝试最长的合法目录名
        path = drive
        i = 0
        while i < len(tokens):
            found = False
            for j in range(len(tokens), i, -1):
                candidate = "_".join(tokens[i:j])
                test = os.path.join(path, candidate)
                if os.path.exists(test):
                    path = test
                    i = j
                    found = True
                    break
            if not found:
                path = os.path.join(path, tokens[i])
                i += 1
        return os.path.normpath(path)

    # ─── RPC 调用 ─────────────────────────────────────────

    def _headers_json(self) -> dict:
        return {
            "content-type": "application/json",
            "connect-protocol-version": "1",
            "x-codeium-csrf-token": self._csrf,
            "origin": "vscode-file://vscode-app",
        }

    def _headers_proto(self) -> dict:
        return {
            "content-type": "application/proto",
            "connect-protocol-version": "1",
            "x-codeium-csrf-token": self._csrf,
            "origin": "vscode-file://vscode-app",
        }

    def _rpc_url(self, method: str) -> str:
        return f"{self._base_url}/{self.SVC}/{method}"

    async def _start_cascade(self, client: httpx.AsyncClient) -> str:
        """创建新会话，返回 cascade_id"""
        resp = await client.post(
            self._rpc_url("StartCascade"),
            headers=self._headers_proto(),
            content=b"",
        )
        if resp.status_code != 200:
            raise RuntimeError(f"StartCascade failed: HTTP {resp.status_code}")
        data = resp.content
        return data[2:2 + data[1]].decode("utf-8")

    async def _send_message(self, client: httpx.AsyncClient,
                            cascade_id: str, message: str,
                            model: str = None):
        """用 JSON 格式发送消息（IDE 实际使用的接口）"""
        payload = {
            "cascadeId": cascade_id,
            "items": [{"text": message}],
            "metadata": {
                "ideName": "antigravity",
                "apiKey": self._oauth,
                "locale": "en",
                "ideVersion": "1.19.6",
                "extensionName": "antigravity",
            },
            "cascadeConfig": {
                "plannerConfig": {
                    "conversational": {
                        "plannerMode": "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
                        "agenticMode": True,
                    },
                    "toolConfig": {
                        "runCommand": {
                            "autoCommandConfig": {
                                "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
                            }
                        },
                        "notifyUser": {
                            "artifactReviewMode": "ARTIFACT_REVIEW_MODE_ALWAYS"
                        },
                    },
                    "requestedModel": {"model": model or self._current_model},
                    "ephemeralMessagesConfig": {"enabled": True},
                    "knowledgeConfig": {"enabled": True},
                },
                "conversationHistoryConfig": {"enabled": True},
            },
            "clientType": "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE",
        }

        resp = await client.post(
            self._rpc_url("SendUserCascadeMessage"),
            headers=self._headers_json(),
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"SendMessage failed: HTTP {resp.status_code}")

    async def _get_steps(self, client: httpx.AsyncClient,
                         cascade_id: str) -> dict:
        """获取 GetCascadeTrajectorySteps JSON"""
        resp = await client.post(
            self._rpc_url("GetCascadeTrajectorySteps"),
            headers=self._headers_json(),
            json={"cascadeId": cascade_id},
        )
        if resp.status_code != 200:
            return {}
        return resp.json()

    async def _get_models(self, client: httpx.AsyncClient) -> dict:
        """获取可用模型列表"""
        resp = await client.post(
            self._rpc_url("GetCommandModelConfigs"),
            headers=self._headers_proto(),
            content=b"",
        )
        if resp.status_code != 200:
            return {}
        return resp.json() if "json" in resp.headers.get("content-type", "") else {}

    async def rpc_call(self, method: str, body: dict = None) -> dict:
        """通用 RPC 代理：调用任意 LS 接口并返回 JSON"""
        async with httpx.AsyncClient(verify=False, http2=True, timeout=10.0) as client:
            resp = await client.post(
                self._rpc_url(method),
                headers=self._headers_json(),
                json=body or {},
            )
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}", "body": resp.text[:200]}
            ct = resp.headers.get("content-type", "")
            if "json" in ct:
                return resp.json()
            return {"raw_hex": resp.content[:200].hex(), "size": len(resp.content)}

    # ─── 核心业务方法 ─────────────────────────────────────

    async def chat(self, message: str, conv_id: str = None,
                   timeout: float = 600.0,
                   idle_timeout: float = 60.0,
                   model: str = None) -> ChatResult:
        """
        完整对话流程:
        1. StartCascade（如无 conv_id）
        2. SendUserCascadeMessage（JSON 格式）
        3. 轮询 GetCascadeTrajectorySteps
        4. 解析 steps，提取 text/thinking/actions
        5. 返回 ChatResult

        超时策略:
        - idle_timeout: steps 无变化的最大等待时间（默认 60s）
                        只要插件还在重试（steps 在变），就继续等
        - timeout:      绝对上限（默认 600s）
        """
        start = time.time()
        last_change_time = start  # 最后一次 steps 变化的时间

        async with httpx.AsyncClient(verify=False, http2=True, timeout=15.0) as client:
            # Step 1: 创建或复用会话
            if not conv_id:
                conv_id = await self._start_cascade(client)

            # Step 2: 发送消息前记录 baseline
            pre_data = await self._get_steps(client, conv_id)
            baseline = len(pre_data.get("steps", []))

            # Step 3: 发送消息
            await self._send_message(client, conv_id, message, model=model)

            # Step 4: 轮询等待（只分析 baseline 之后的新 steps）
            last_step_count = baseline
            last_steps = []

            def _build(steps, error=""):
                p = StepsParser(steps)
                return ChatResult(
                    conv_id=conv_id,
                    reply=p.extract_response_text(),
                    thinking=p.extract_thinking_content(),
                    actions=[vars(a) for a in p.extract_actions()],
                    milestones=p.extract_milestones(),
                    retries=p.count_retries(),
                    steps_count=len(steps),
                    elapsed=time.time() - start,
                    error=error,
                    raw_steps=steps,
                )

            while True:
                now = time.time()
                elapsed = now - start
                idle_elapsed = now - last_change_time

                if elapsed > timeout:
                    return _build(last_steps, "timeout")

                if idle_elapsed > idle_timeout and last_steps:
                    return _build(last_steps, "idle_timeout")

                await asyncio.sleep(random.uniform(0.15, 0.25))

                data = await self._get_steps(client, conv_id)
                all_steps = data.get("steps", [])
                if len(all_steps) <= baseline:
                    continue

                new_steps = all_steps[baseline:]

                if len(all_steps) != last_step_count:
                    last_step_count = len(all_steps)
                    last_change_time = time.time()

                last_steps = new_steps
                parser = StepsParser(new_steps)

                # ── 完成检测 ──
                last_type = new_steps[-1].get("type", "")

                # CHECKPOINT → agentic 完成
                if "CHECKPOINT" in last_type:
                    return _build(new_steps)

                # PLANNER_RESPONSE DONE + 有文本
                if parser.is_response_done() and parser.extract_response_text():
                    return _build(new_steps)

    async def get_status(self, conv_id: str) -> dict:
        """获取会话当前状态快照"""
        async with httpx.AsyncClient(verify=False, http2=True, timeout=10.0) as client:
            data = await self._get_steps(client, conv_id)
        steps = data.get("steps", [])
        parser = StepsParser(steps)
        return parser.summary()

    def set_model(self, model: str) -> str:
        """切换模型，返回之前的模型"""
        prev = self._current_model
        self._current_model = model
        return prev

    def get_instances(self) -> list[dict]:
        """返回所有 LS 实例信息"""
        return [{
            "pid": inst.pid,
            "port": inst.server_port,
            "workspace": getattr(inst, "workspace_id", ""),
            "ext_port": getattr(inst, "ext_port", 0),
        } for inst in self._instances_cache]

    def refresh_instances(self) -> dict:
        """刷新 LS 实例缓存"""
        old = set(inst.server_port for inst in self._instances_cache)
        self._instances_cache = discover_ls_instances()
        new = set(inst.server_port for inst in self._instances_cache)
        return {
            "previous_count": len(old),
            "current_count": len(new),
            "new_ports": list(new - old),
            "removed_ports": list(old - new),
        }

    # ─── 会话 ID 持久化 ───────────────────────────────────

    @staticmethod
    def save_session(label: str, conv_id: str,
                     path: str = None):
        """保存会话 ID 到 temp/test_sessions.json"""
        if not path:
            path = os.path.join(os.path.dirname(__file__), "..",
                                "temp", "test_sessions.json")
        sessions = {}
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                sessions = json.load(f)
        sessions[label] = conv_id
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(sessions, f, indent=2)

    @staticmethod
    def load_session(label: str, path: str = None) -> Optional[str]:
        """加载保存的会话 ID"""
        if not path:
            path = os.path.join(os.path.dirname(__file__), "..",
                                "temp", "test_sessions.json")
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            sessions = json.load(f)
        return sessions.get(label)


# ─── CLI 入口 ────────────────────────────────────────────────

async def _cli():
    import argparse
    parser = argparse.ArgumentParser(description="AntigravityCore CLI")
    parser.add_argument("message", help="Message to send")
    parser.add_argument("--port", type=int, default=5490)
    parser.add_argument("--conv", default=None, help="Reuse conversation ID")
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--save", default=None, help="Save conv_id with this label")
    args = parser.parse_args()

    core = AntigravityCore(port=args.port)
    print("LS: port=%d" % core.port)
    print("Message: %s" % args.message)
    print()

    result = await core.chat(args.message, conv_id=args.conv, timeout=args.timeout)

    print("--- Result ---")
    print("Reply: %s" % result.reply[:500])
    if result.thinking:
        print("Thinking: %s" % result.thinking[:200])
    print("Steps: %d" % result.steps_count)
    print("Elapsed: %.1fs" % result.elapsed)
    print("Conv ID: %s" % result.conv_id)
    if result.error:
        print("Error: %s" % result.error)

    if args.save:
        AntigravityCore.save_session(args.save, result.conv_id)
        print("Saved session '%s' -> %s" % (args.save, result.conv_id))


if __name__ == "__main__":
    asyncio.run(_cli())
