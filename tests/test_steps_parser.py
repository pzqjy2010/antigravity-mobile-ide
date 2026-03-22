# -*- coding: utf-8 -*-
"""
Steps 解析器测试 — 用 temp/steps_full.json 验证。

用法:
    python test_steps_parser.py
"""
import json, sys, os

# 让 import 能找到同目录模块
sys.path.insert(0, os.path.dirname(__file__))
from steps_parser import StepsParser

def main():
    # 加载测试数据
    json_path = os.path.join(os.path.dirname(__file__), "..", "temp", "steps_full.json")
    if not os.path.exists(json_path):
        print(f"ERROR: 找不到测试数据 {json_path}")
        return 1

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    steps = data.get("steps", [])
    parser = StepsParser(steps)

    print("=" * 60)
    print("Steps 解析器测试")
    print("=" * 60)

    # 测试 1: Step 数量和类型识别
    actions = parser.extract_actions()
    print(f"\n[测试1] Step 数量: {len(steps)}")
    for i, action in enumerate(actions):
        print(f"  step[{i}]: type={action.type}, status={action.status}")
        if action.content:
            print(f"           content={action.content[:80]}...")

    # 测试 2: 提取用户输入
    user_inputs = [a for a in actions if a.type == "user_input"]
    print(f"\n[测试2] 用户输入 ({len(user_inputs)} 个):")
    for ui in user_inputs:
        print(f"  userResponse = \"{ui.content}\"")

    # 测试 3: 识别错误
    errors = [a for a in actions if a.type == "error"]
    print(f"\n[测试3] 错误 ({len(errors)} 个):")
    for err in errors:
        print(f"  error = \"{err.content[:60]}\"")
        print(f"  errorCode = {err.detail.get('errorCode')}")
        print(f"  shouldShowUser = {err.detail.get('shouldShowUser')}")

    # 测试 4: 回复文本
    text = parser.extract_response_text()
    print(f"\n[测试4] AI 回复文本: \"{text[:100]}\"" if text else "\n[测试4] AI 回复文本: (空)")

    # 测试 5: Thinking
    thinking = parser.extract_thinking_content()
    print(f"\n[测试5] Thinking: {'有 (' + str(len(thinking)) + ' chars)' if thinking else '无'}")

    # 测试 6: is_response_done
    done = parser.is_response_done()
    print(f"\n[测试6] is_response_done: {done}")

    # 测试 7: has_active_error
    has_err = parser.has_active_error()
    print(f"\n[测试7] has_active_error: {has_err}")

    # 测试 8: Usage
    usage = parser.extract_model_usage()
    print(f"\n[测试8] ModelUsage: {vars(usage) if usage else '无'}")

    # 测试 9: Summary
    print(f"\n[测试9] Summary:")
    s = parser.summary()
    for k, v in s.items():
        print(f"  {k}: {v}")

    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
