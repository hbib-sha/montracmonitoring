#!/usr/bin/env python3
"""
make_sample_data.py
===================

Generate a synthetic recording-run CSV (in the exact format the Montrac system
exports) for demonstrating / sanity-checking the validation charts.

Error model (actual - predicted), reflecting the real behaviour:
  * Segments whose DESTINATION is a positioning SENSOR  -> mean +1.0 s, low variance
    (the shuttle approaches the sensor at a controlled, repeatable speed).
  * All other segments (ending at IRM / IRM_ID)         -> mean +3.0 s, high variance
    (queueing, GO-release timing and station dwell make these noisy, ~1-5 s).

Usage:
    python analysis/make_sample_data.py                 # -> analysis/sample_run.csv
    python analysis/make_sample_data.py out.csv --laps 16 --seed 7
"""
from __future__ import annotations

import argparse
import csv
import io
import random
from pathlib import Path

# Loop checkpoint types come straight from the DB seed (db/index.ts).
LOOPS = {
    1: {"shuttle": 2,   "types": ["IRM_ID", "SENSOR", "IRM"]},
    2: {"shuttle": 3,   "types": ["IRM_ID", "SENSOR", "IRM"]},
    3: {"shuttle": 255, "types": ["IRM_ID", "SENSOR", "IRM_ID", "SENSOR"]},
}

# Error model in milliseconds: (mean, std, clip_lo, clip_hi)
ERR_BEFORE_SENSOR = (1000, 250, 400, 1900)     # low bias, tight
ERR_OTHER         = (3000, 1150, 1000, 5000)    # higher bias, wide spread


def csv_block(header: str, rows: list[list]) -> list[str]:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="")
    out = [header]
    for r in rows:
        buf.seek(0); buf.truncate(0)
        w.writerow(r)
        out.append(buf.getvalue())
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate a sample run CSV for the validation charts.")
    ap.add_argument("out", type=Path, nargs="?", default=Path(__file__).with_name("sample_run.csv"))
    ap.add_argument("--laps", type=int, default=14, help="laps per loop (points per segment)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    t0 = 1_751_000_000_000  # arbitrary epoch-ms start

    lines: list[str] = []

    # ── RUN ──
    lines.append("=== RUN ===")
    lines += csv_block(
        "id,name,startedAt,endedAt,status,mode,sampleIntervalMs,notes",
        [[1, "Calibration validation laps", "2026-07-01T09:00:00Z",
          "2026-07-01T09:15:00Z", "stopped", "real", 1000, ""]],
    )
    lines.append("")

    # ── SEGMENT TIMINGS (the data the predicted-vs-actual chart uses) ──
    seg_rows: list[list] = []
    sid = 1
    for loop_id, cfg in LOOPS.items():
        types = cfg["types"]
        n = len(types)
        for f in range(n):
            to = (f + 1) % n
            before_sensor = types[to] == "SENSOR"
            # Nominal predicted ETA (constant per segment, like distance / avg-speed).
            predicted = 6500 + f * 1700 + (loop_id - 1) * 500
            mean, std, lo, hi = ERR_BEFORE_SENSOR if before_sensor else ERR_OTHER
            for lap in range(args.laps):
                err = max(lo, min(hi, rng.gauss(mean, std)))
                actual = int(round(predicted + err))
                ts = f"2026-07-01T09:{lap:02d}:{(f*7) % 60:02d}Z"
                seg_rows.append([sid, loop_id, cfg["shuttle"], f, to, predicted, actual, ts])
                sid += 1

    lines.append("=== SEGMENT TIMINGS ===")
    lines += csv_block(
        "id,loopId,shuttleId,fromIndex,toIndex,predictedEtaMs,actualElapsedMs,recordedAt",
        seg_rows,
    )
    lines.append("")

    # ── SAMPLES (so the activity-timeline chart has something to draw) ──
    sample_rows = [[i + 1, t0 + i * 1000, 1, "real", 3, 0] for i in range(180)]
    lines.append("=== SAMPLES ===")
    lines += csv_block("id,t,connected,mode,activeShuttleCount,crashedCount", sample_rows)
    lines.append("")

    # ── CRASH MARKERS (kept empty — present for format fidelity) ──
    lines.append("=== CRASH MARKERS ===")
    lines.append("id,loopId,actualCrashAtMs,detectedAtMs,detectionLatencyMs,detectedEventId,note,createdAt")

    args.out.write_text("\r\n".join(lines), encoding="utf-8", newline="")
    print(f"wrote {args.out}  ({len(seg_rows)} segment timings, {args.laps} laps/segment)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
