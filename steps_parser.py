# -*- coding: utf-8 -*-
"""
Steps 解析器 — 从 GetCascadeTrajectorySteps JSON 中提取结构化信息。

参考: ZeroGravity polling.rs

用法:
    from steps_parser import StepsParser
    parser = StepsParser(steps_json["steps"])
    text = parser.extract_response_text()
    done = parser.is_response_done()
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ModelUsage:
    """Token 用量"""
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    api_provider: str = ""


@dataclass
class StepAction:
    """AI 执行的一个动作"""
    type: str           # user_input, planner_response, error, tool_call, command, file_edit
    status: str = ""
    content: str = ""   # 主要内容（文本/命令/路径）
    detail: dict = field(default_factory=dict)  # 额外信息


class StepsParser:
    """GetCascadeTrajectorySteps JSON 解析器"""

    def __init__(self, steps: list[dict]):
        self.steps = steps or []

    def extract_response_text(self) -> str:
        """提取 AI 回复文本（反向扫描，取最新有文本的 PLANNER_RESPONSE）"""
        for step in reversed(self.steps):
            step_type = step.get("type", "")
            if "PLANNER_RESPONSE" in step_type:
                resp = step.get("plannerResponse", {})
                text = resp.get("rawResponse") or resp.get("response") or ""
                if text:
                    return text
            # 兼容可能的其他类型名
            if "AI_RESPONSE" in step_type or "MODEL_RESPONSE" in step_type:
                text = (step.get("response") or step.get("rawResponse")
                        or step.get("text") or "")
                if text:
                    return text
        return ""

    def extract_thinking_content(self) -> Optional[str]:
        """提取 thinking/reasoning 内容"""
        for step in reversed(self.steps):
            if "PLANNER_RESPONSE" in step.get("type", ""):
                thinking = step.get("plannerResponse", {}).get("thinking", "")
                if thinking:
                    return thinking
        return None

    def extract_thinking_signature(self) -> Optional[str]:
        """提取 thinking signature（Anthropic 多轮对话需要）"""
        for step in reversed(self.steps):
            if "PLANNER_RESPONSE" in step.get("type", ""):
                sig = step.get("plannerResponse", {}).get("thinkingSignature", "")
                if sig:
                    return sig
        return None

    def extract_model_usage(self) -> Optional[ModelUsage]:
        """提取 token 用量（从 metadata.modelUsage）"""
        for step in reversed(self.steps):
            usage_data = (step.get("metadata") or {}).get("modelUsage")
            if not usage_data:
                continue
            input_t = usage_data.get("inputTokens", 0)
            output_t = usage_data.get("outputTokens", 0)
            # 可能是字符串格式
            if isinstance(input_t, str):
                input_t = int(input_t) if input_t.isdigit() else 0
            if isinstance(output_t, str):
                output_t = int(output_t) if output_t.isdigit() else 0
            if input_t > 0 or output_t > 0:
                return ModelUsage(
                    input_tokens=input_t,
                    output_tokens=output_t,
                    model=usage_data.get("model", ""),
                    api_provider=usage_data.get("apiProvider", ""),
                )
        return None

    def is_response_done(self) -> bool:
        """判断 cascade 是否已完成"""
        if not self.steps:
            return False
        last = self.steps[-1]
        last_type = last.get("type", "")
        last_status = last.get("status", "")

        # CHECKPOINT = 确定完成
        if "CHECKPOINT" in last_type:
            return True
        # PLANNER_RESPONSE + DONE = 最终回复
        if ("PLANNER_RESPONSE" in last_type or "AI_RESPONSE" in last_type) \
                and "DONE" in last_status:
            return True
        return False

    def has_completed_actions(self) -> bool:
        """检查是否有已完成的实际工作（code_action/command 等）"""
        for step in self.steps:
            t = step.get("type", "")
            if any(k in t for k in ["CODE_ACTION", "COMMAND_EXECUTION",
                                     "FILE_EDIT", "TOOL_CALL"]):
                return True
        return False

    def is_error_stalled(self) -> bool:
        """检查是否陷入 503 错误循环（连续 error 无新进展）"""
        if len(self.steps) < 4:
            return False
        # 检查最后 4 个 step 是否全是 error/planner_response 交替
        tail = self.steps[-4:]
        err_count = sum(1 for s in tail if "ERROR_MESSAGE" in s.get("type", ""))
        return err_count >= 2

    def has_active_error(self) -> bool:
        """检查最后一个 step 是否为未恢复的错误"""
        if not self.steps:
            return False
        last = self.steps[-1]
        return "ERROR_MESSAGE" in last.get("type", "") \
            and last.get("errorMessage", {}).get("shouldShowUser", False)

    def extract_actions(self) -> list[StepAction]:
        """提取所有 step 的结构化动作列表"""
        actions = []
        for step in self.steps:
            step_type = step.get("type", "")
            status = step.get("status", "")
            short_type = step_type.replace("CORTEX_STEP_TYPE_", "")

            if "USER_INPUT" in step_type:
                user_input = step.get("userInput", {})
                actions.append(StepAction(
                    type="user_input",
                    status=status,
                    content=user_input.get("userResponse", ""),
                ))

            elif "PLANNER_RESPONSE" in step_type:
                resp = step.get("plannerResponse", {})
                text = resp.get("rawResponse") or resp.get("response") or ""
                actions.append(StepAction(
                    type="planner_response",
                    status=status,
                    content=text,
                    detail={
                        "stopReason": resp.get("stopReason", ""),
                        "thinking": resp.get("thinking", ""),
                    },
                ))

            elif "ERROR_MESSAGE" in step_type:
                err = step.get("errorMessage", {}).get("error", {})
                actions.append(StepAction(
                    type="error",
                    status=status,
                    content=err.get("userErrorMessage", ""),
                    detail={
                        "errorCode": err.get("errorCode", 0),
                        "shortError": err.get("shortError", ""),
                        "shouldShowUser": step.get("errorMessage", {}).get("shouldShowUser", False),
                    },
                ))

            elif "CONVERSATION_HISTORY" in step_type:
                actions.append(StepAction(type="conversation_history", status=status))

            elif "KNOWLEDGE_ARTIFACTS" in step_type:
                actions.append(StepAction(type="knowledge_artifacts", status=status))

            elif "EPHEMERAL_MESSAGE" in step_type:
                actions.append(StepAction(type="ephemeral_message", status=status))

            else:
                # 未知类型 — 保留原始信息，Step 3 时补充
                actions.append(StepAction(
                    type=short_type.lower(),
                    status=status,
                    detail={"raw_type": step_type},
                ))

        return actions

    def extract_milestones(self) -> list[dict]:
        """提取里程碑（前端展示用：只保留有意义的动作节点）"""
        milestones = []
        for step in self.steps:
            t = step.get("type", "")
            short = t.replace("CORTEX_STEP_TYPE_", "").lower()

            if "CODE_ACTION" in t:
                milestones.append({"type": "code_action", "desc": "编辑/创建文件"})
            elif "RUN_COMMAND" in t:
                milestones.append({"type": "run_command", "desc": "执行命令"})
            elif "SEND_COMMAND_INPUT" in t:
                milestones.append({"type": "command_input", "desc": "发送输入"})
            elif "CHECKPOINT" in t:
                milestones.append({"type": "checkpoint", "desc": "阶段完成"})
            elif "TASK_BOUNDARY" in t:
                milestones.append({"type": "task_boundary", "desc": "任务切换"})
        return milestones

    def count_retries(self) -> int:
        """统计 503 重试次数"""
        return sum(1 for s in self.steps if "ERROR_MESSAGE" in s.get("type", ""))

    def summary(self) -> dict:
        """返回解析摘要"""
        return {
            "steps_count": len(self.steps),
            "response_text": self.extract_response_text()[:100],
            "thinking": bool(self.extract_thinking_content()),
            "is_done": self.is_response_done(),
            "has_error": self.has_active_error(),
            "has_actions": self.has_completed_actions(),
            "is_stalled": self.is_error_stalled(),
            "usage": vars(self.extract_model_usage()) if self.extract_model_usage() else None,
            "step_types": [s.get("type", "").replace("CORTEX_STEP_TYPE_", "")
                          for s in self.steps],
        }
