"""测试 GetCascadeTrajectorySteps - 保存输出到文件"""
import json, urllib.request

BASE = "http://localhost:16601"

# 获取所有会话
req = urllib.request.Request(f"{BASE}/v1/ls/rpc/GetAllCascadeTrajectories",
    data=b'{}', headers={"Content-Type": "application/json"}, method="POST")
data = json.loads(urllib.request.urlopen(req, timeout=10).read())
items = list(data.get("trajectorySummaries", {}).items())
cid = items[0][0]

# 获取步骤
req2 = urllib.request.Request(f"{BASE}/v1/ls/rpc/GetCascadeTrajectorySteps",
    data=json.dumps({"cascadeId": cid}).encode(),
    headers={"Content-Type": "application/json"}, method="POST")
d2 = json.loads(urllib.request.urlopen(req2, timeout=15).read())

# 保存完整 JSON
import os
out = os.path.join(os.path.dirname(__file__), "..", "data", "trajectory_steps_sample.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(d2, f, indent=2, ensure_ascii=False)

steps = d2.get("steps", [])
print(f"OK! {len(steps)} steps saved to trajectory_steps_sample.json")
if steps:
    print(f"step[0] keys: {list(steps[0].keys())}")
