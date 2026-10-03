#!/usr/bin/env python3
"""
Edge TTS 批量合成后端（任务 A · 构建期专用）

被 scripts/build-audio-tts.mjs 通过 child_process 调用：
    python scripts/edge_tts_batch.py <work-list.json>

work-list 结构：
    {
      "outDir": "dist/audio/tts",
      "rate": "+0%",                 # 语速 1.0 → edge-tts 的 +0%
      "concurrency": 8,
      "items": [ { "id": "q_xxx", "text": "...", "voice": "en-US-AriaNeural" } ]
    }

结果写回：
    <work-list 同目录>/<basename>.result.json → { "generated": [...], "failed": [{id, error}] }

依赖：pip install edge-tts（构建期依赖，运行时不涉及任何 TTS API）
"""
import asyncio
import json
import os
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    print("❌ 缺少 edge-tts：请先执行 pip install edge-tts", file=sys.stderr)
    sys.exit(2)


async def synth(sem, item, out_dir, rate, results):
    path = os.path.join(out_dir, item["id"] + ".mp3")
    async with sem:
        last = None
        for _ in range(2):  # 每条最多重试 1 次
            try:
                c = edge_tts.Communicate(item["text"], item["voice"], rate=rate)
                await c.save(path)
                if os.path.exists(path) and os.path.getsize(path) > 0:
                    results["generated"].append(item["id"])
                    return
                last = "empty output"
            except Exception as e:  # noqa: BLE001 —— 单条失败不阻塞
                last = str(e)
                await asyncio.sleep(1.0)
        results["failed"].append({"id": item["id"], "error": last or "unknown"})


async def main():
    work_path = Path(sys.argv[1])
    work = json.loads(work_path.read_text(encoding="utf-8"))
    out_dir = work["outDir"]
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    items = work["items"]
    rate = work.get("rate", "+0%")
    conc = int(work.get("concurrency", 8))

    results = {"generated": [], "failed": []}
    sem = asyncio.Semaphore(conc)
    tasks = [synth(sem, it, out_dir, rate, results) for it in items]

    done = 0
    for fut in asyncio.as_completed(tasks):
        await fut
        done += 1
        if done % 200 == 0:
            print(f"   … {done}/{len(items)}（失败 {len(results['failed'])}）", flush=True)

    result_path = work_path.with_suffix(".result.json")
    result_path.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
    print(f"batch done: generated={len(results['generated'])} failed={len(results['failed'])}", flush=True)
    sys.exit(1 if results["failed"] else 0)


if __name__ == "__main__":
    asyncio.run(main())
