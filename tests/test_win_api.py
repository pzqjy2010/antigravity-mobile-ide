"""列出所有 LS 实例和 AG IDE 窗口（输出到文件）"""
import json, urllib.request

BASE = "http://localhost:16601"
def get(path):
    r = urllib.request.urlopen(f"{BASE}{path}")
    return json.loads(r.read())

lines = []
def p(s): lines.append(s); print(s)

insts = get("/v1/instances")
p(f"=== LS 实例 ({len(insts['instances'])}) ===")
for i, inst in enumerate(insts["instances"]):
    p(f"  [{i+1}] port={inst['port']}  display_name='{inst.get('display_name','')}'")
    p(f"       workspace='{inst.get('workspace','')}'")

wins = get("/v1/system/windows?title=Antigravity&process=Antigravity.exe")
p(f"\n=== AG IDE 窗口 ({wins['count']}) ===")
for i, w in enumerate(wins["windows"]):
    ws = w["title"].split(" - ")[0].strip() if " - " in w["title"] else "?"
    tag = "[MIN]" if w["is_minimized"] else f"[{w['width']}x{w['height']}]"
    p(f"  [{i+1}] ws_from_title='{ws}'  {tag}")
    p(f"       full_title='{w['title']}'")

with open("workspace_list.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("\n写入 workspace_list.txt")
