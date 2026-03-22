import json, urllib.request, os

BASE = "http://localhost:16601"

# 获取 cascadeId
req = urllib.request.Request(f"{BASE}/v1/ls/rpc/GetAllCascadeTrajectories",
    data=b'{}', headers={"Content-Type": "application/json"}, method="POST")
data = json.loads(urllib.request.urlopen(req, timeout=10).read())
items = list(data.get("trajectorySummaries", {}).items())
cid = items[0][0]

print(f"Testing GetCascadeTrajectory for {cid} (30s timeout)")
try:
    req = urllib.request.Request(f"{BASE}/v1/ls/rpc/GetCascadeTrajectory",
        data=json.dumps({"cascadeId": cid}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    resp = urllib.request.urlopen(req, timeout=30)
    d = json.loads(resp.read())
    print("SUCCESS!")
    print("KEYS:", list(d.keys()))
    out = os.path.join(os.path.dirname(__file__), "..", "temp", "cascade_full.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
except Exception as e:
    print(f"Error: {e}")
    if hasattr(e, 'read'):
        print(e.read().decode())
