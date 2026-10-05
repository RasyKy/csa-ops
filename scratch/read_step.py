import json

log_path = r"C:\Users\rasyy\.gemini\antigravity\brain\dc0c8f53-6557-4077-94a7-c1793af1dcc4\.system_generated\logs\transcript_full.jsonl"
with open(log_path, "r", encoding="utf-8") as f:
    for line in f:
        if '"step_index":2825' in line:
            obj = json.loads(line)
            print(obj.get("content", ""))
            break
