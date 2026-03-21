# -*- coding: utf-8 -*-
import sys, os, json, asyncio
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
_tool_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)
import warnings; warnings.filterwarnings("ignore")
from ag_core import AntigravityCore

async def main():
    core = AntigravityCore()
    print("Port:", core.port)
    data = await core.rpc_call("GetAllCascadeTrajectories")
    trajs = data.get("trajectories", [])
    print(f"Conversations: {len(trajs)}")
    for t in trajs[:3]:
        print(f"  {t.get('cascadeId','')[:20]}  {t.get('displayName','')}")
    
    if trajs:
        cid = trajs[0]["cascadeId"]
        steps_data = await core.rpc_call("GetCascadeTrajectorySteps", {"cascadeId": cid})
        steps = steps_data.get("steps", [])
        print(f"\nSteps: {len(steps)}")
        print("--- Types ---")
        for i, s in enumerate(steps):
            print(f"  {i}: {s.get('type','').replace('CORTEX_STEP_TYPE_','')}")
        
        # Dump any IMAGE related steps
        for i, s in enumerate(steps):
            t = s.get("type", "").upper()
            if "IMAGE" in t or "GENERATE" in t:
                print(f"\n=== IMAGE STEP {i} ===")
                # Truncate large base64 data
                dump = json.dumps(s, ensure_ascii=False)
                if len(dump) > 5000:
                    print(dump[:5000] + "\n... (truncated)")
                else:
                    print(dump)

asyncio.run(main())
