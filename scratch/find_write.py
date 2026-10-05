import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
log_path = r"C:\Users\rasyy\.gemini\antigravity\brain\dc0c8f53-6557-4077-94a7-c1793af1dcc4\.system_generated\logs\transcript_full.jsonl"
with open(log_path, "r", encoding="utf-8") as f:
    for line in f:
        if 'incident_graph.spec.ts' in line and '"TargetFile"' in line:
            obj = json.loads(line)
            for call in obj.get("tool_calls", []):
                args = call.get("args", {})
                if "TargetFile" in args and "incident_graph.spec.ts" in args["TargetFile"]:
                    print(f"Step {obj.get('step_index')}")
                    with open(r"scratch/last_spec.ts", "w", encoding="utf-8") as out:
                        out.write(args.get("CodeContent", ""))
                    print("Wrote to scratch/last_spec.ts")
