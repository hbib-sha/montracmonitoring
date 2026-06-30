#!/usr/bin/env python3
"""
generate_report_charts.py
=========================

Generate publication-quality charts that validate the digital-twin DES against
actual data, from a recording-run CSV exported by the Montrac Monitoring System
(Reports page -> "Export CSV").

It produces, for the chosen run:

  1. predicted_vs_actual   - DES predicted ETA vs measured actual time (the core
                             predictive-accuracy chart, with identity line + R2/RMSE)
  2. error_distribution    - histogram of prediction error (actual - predicted)
  3. residuals_vs_predicted- residual plot to reveal bias growing with distance
  4. error_by_segment      - mean absolute error per loop segment (where the twin
                             predicts well vs poorly)
  5. activity_timeline     - active vs crashed shuttles over the run

Each chart is saved as both .png (300 dpi) and .pdf (vector) with a title,
labelled & unit-tagged axes, legend, and balanced proportions.

Usage
-----
    pip install -r analysis/requirements.txt
    python analysis/generate_report_charts.py run-3.csv
    python analysis/generate_report_charts.py run-3.csv --outdir figs --show

The CSV is the multi-section file emitted by GET /api/recording/runs/:id/export
(sections delimited by "=== NAME ===").
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Okabe-Ito colour-blind-safe palette
PALETTE = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442"]
LOOP_COLOR = {1: PALETTE[0], 2: PALETTE[1], 3: PALETTE[2]}


def style() -> None:
    """Apply a clean, paper-friendly Matplotlib style."""
    plt.rcParams.update({
        "figure.dpi": 110,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "font.size": 11,
        "axes.titlesize": 13,
        "axes.titleweight": "bold",
        "axes.labelsize": 11,
        "axes.grid": True,
        "grid.alpha": 0.30,
        "grid.linestyle": "--",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "legend.fontsize": 9,
        "legend.frameon": False,
    })


# --------------------------------------------------------------------------- #
# CSV parsing                                                                  #
# --------------------------------------------------------------------------- #
def parse_sections(text: str) -> dict[str, list[dict]]:
    """Split the multi-section export into {SECTION_NAME: [row dicts]}."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        m = re.match(r"^===\s*(.+?)\s*===$", line.strip())
        if m:
            current = m.group(1).strip()
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line)

    out: dict[str, list[dict]] = {}
    for name, blk in blocks.items():
        content = [ln for ln in blk if ln.strip() != ""]
        out[name] = list(csv.DictReader(io.StringIO("\n".join(content)))) if content else []
    return out


def to_frame(rows: list[dict], numeric: list[str]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for col in numeric:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


# --------------------------------------------------------------------------- #
# Metrics                                                                       #
# --------------------------------------------------------------------------- #
def accuracy_metrics(pred: np.ndarray, act: np.ndarray) -> dict[str, float]:
    err = act - pred
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((act - act.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    nonzero = act != 0
    mape = float(np.mean(np.abs(err[nonzero] / act[nonzero])) * 100) if nonzero.any() else float("nan")
    return {
        "n": int(len(pred)),
        "mean_bias_s": float(err.mean()),
        "mae_s": float(np.abs(err).mean()),
        "rmse_s": float(np.sqrt(np.mean(err ** 2))),
        "mape_pct": mape,
        "r2": float(r2),
    }


def save(fig, name: str, outdir: Path) -> None:
    for ext in ("png", "pdf"):
        fig.savefig(outdir / f"{name}.{ext}")
    print(f"  wrote {name}.png / .pdf")


# --------------------------------------------------------------------------- #
# Charts                                                                        #
# --------------------------------------------------------------------------- #
def chart_predicted_vs_actual(seg: pd.DataFrame, suffix: str, outdir: Path) -> None:
    fig, ax = plt.subplots(figsize=(5.2, 5.2))
    lim = max(seg["pred_s"].max(), seg["act_s"].max()) * 1.08
    ax.plot([0, lim], [0, lim], ls="--", color="#666666", lw=1.2, label="Perfect prediction (y = x)")

    for loop, g in seg.groupby("loopId"):
        ax.scatter(g["pred_s"], g["act_s"], s=34, alpha=0.75,
                   color=LOOP_COLOR.get(int(loop), PALETTE[int(loop) % len(PALETTE)]),
                   edgecolors="white", linewidths=0.4, label=f"Loop {int(loop)}")

    m = accuracy_metrics(seg["pred_s"].to_numpy(), seg["act_s"].to_numpy())
    box = (f"$n$ = {m['n']}\n$R^2$ = {m['r2']:.3f}\n"
           f"RMSE = {m['rmse_s']:.2f} s\nMAE = {m['mae_s']:.2f} s\n"
           f"bias = {m['mean_bias_s']:+.2f} s")
    ax.text(0.04, 0.96, box, transform=ax.transAxes, va="top", ha="left",
            fontsize=9, family="monospace",
            bbox=dict(boxstyle="round", fc="white", ec="#cccccc", alpha=0.9))

    ax.set_xlim(0, lim)
    ax.set_ylim(0, lim)
    ax.set_aspect("equal")
    ax.set_xlabel("Predicted ETA (s)")
    ax.set_ylabel("Actual elapsed time (s)")
    ax.set_title(f"Digital-twin predicted vs. actual transit time\n{suffix}")
    ax.legend(loc="lower right")
    save(fig, "1_predicted_vs_actual", outdir)
    plt.close(fig)


def chart_error_distribution(seg: pd.DataFrame, suffix: str, outdir: Path) -> None:
    err = seg["err_s"].to_numpy()
    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    bins = max(8, min(40, int(np.sqrt(len(err)) * 2)))
    ax.hist(err, bins=bins, color=PALETTE[0], alpha=0.80, edgecolor="white")
    ax.axvline(0, color="#666666", ls="--", lw=1.2, label="Zero error")
    ax.axvline(err.mean(), color=PALETTE[3], ls="-", lw=1.6,
               label=f"Mean = {err.mean():+.2f} s")
    ax.set_xlabel("Prediction error: actual − predicted (s)")
    ax.set_ylabel("Number of transits")
    ax.set_title(f"Distribution of digital-twin prediction error\n{suffix}")
    ax.legend()
    save(fig, "2_error_distribution", outdir)
    plt.close(fig)


def chart_residuals(seg: pd.DataFrame, suffix: str, outdir: Path) -> None:
    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    for loop, g in seg.groupby("loopId"):
        ax.scatter(g["pred_s"], g["err_s"], s=30, alpha=0.75,
                   color=LOOP_COLOR.get(int(loop), PALETTE[int(loop) % len(PALETTE)]),
                   edgecolors="white", linewidths=0.4, label=f"Loop {int(loop)}")
    ax.axhline(0, color="#666666", ls="--", lw=1.2)
    ax.set_xlabel("Predicted ETA (s)")
    ax.set_ylabel("Residual: actual − predicted (s)")
    ax.set_title(f"Prediction residuals vs. predicted ETA\n{suffix}")
    ax.legend(loc="best")
    save(fig, "3_residuals_vs_predicted", outdir)
    plt.close(fig)


def chart_error_by_segment(seg: pd.DataFrame, suffix: str, outdir: Path) -> None:
    g = (seg.assign(abs_err=seg["err_s"].abs())
            .groupby(["loopId", "fromIndex", "toIndex"])
            .agg(mae=("abs_err", "mean"), sd=("err_s", "std"), n=("err_s", "size"))
            .reset_index()
            .sort_values(["loopId", "fromIndex"]))
    labels = [f"L{int(r.loopId)} {int(r.fromIndex)}→{int(r.toIndex)}" for r in g.itertuples()]
    colors = [LOOP_COLOR.get(int(l), PALETTE[int(l) % len(PALETTE)]) for l in g["loopId"]]

    fig, ax = plt.subplots(figsize=(max(6.2, 0.7 * len(g) + 1.5), 4.4))
    x = np.arange(len(g))
    ax.bar(x, g["mae"], yerr=g["sd"].fillna(0), capsize=3,
           color=colors, alpha=0.85, edgecolor="white",
           error_kw=dict(ecolor="#555555", lw=1))
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.set_xlabel("Loop segment (from → to checkpoint)")
    ax.set_ylabel("Mean absolute error (s)")
    ax.set_title(f"Prediction error by track segment\n{suffix}")
    save(fig, "4_error_by_segment", outdir)
    plt.close(fig)


def chart_activity_timeline(sm: pd.DataFrame, suffix: str, outdir: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.0, 4.0))
    ax.plot(sm["rel_s"], sm["activeShuttleCount"], color=PALETTE[0], lw=1.6, label="Active shuttles")
    ax.plot(sm["rel_s"], sm["crashedCount"], color=PALETTE[3], lw=1.6, label="Crashed shuttles")
    ax.set_xlabel("Time since run start (s)")
    ax.set_ylabel("Shuttle count")
    ax.set_title(f"Shuttle activity over the run\n{suffix}")
    ax.legend(loc="upper right")
    save(fig, "5_activity_timeline", outdir)
    plt.close(fig)


# --------------------------------------------------------------------------- #
# Main                                                                          #
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="Generate validation charts from a Montrac run CSV export.")
    ap.add_argument("csv", type=Path, help="Path to the exported run CSV")
    ap.add_argument("--outdir", type=Path, default=Path("charts"), help="Output directory (default: ./charts)")
    ap.add_argument("--show", action="store_true", help="Display figures interactively as well as saving")
    args = ap.parse_args()

    if not args.csv.exists():
        print(f"error: {args.csv} not found", file=sys.stderr)
        return 1

    style()
    sections = parse_sections(args.csv.read_text(encoding="utf-8"))
    args.outdir.mkdir(parents=True, exist_ok=True)

    run = sections.get("RUN", [])
    run_name = run[0].get("name", "Recording") if run else "Recording"
    run_mode = run[0].get("mode", "") if run else ""
    suffix = f"Run: {run_name}  ({run_mode} mode)" if run_mode else f"Run: {run_name}"
    if run_mode == "simulation":
        print("WARNING: this run is in SIMULATION mode — 'actual' values are themselves\n"
              "         simulated. Use a REAL-mode run for genuine twin-vs-reality validation.\n")

    seg = to_frame(sections.get("SEGMENT TIMINGS", []),
                   ["loopId", "shuttleId", "fromIndex", "toIndex", "predictedEtaMs", "actualElapsedMs"])
    if not seg.empty:
        seg = seg.dropna(subset=["predictedEtaMs", "actualElapsedMs"])
        seg = seg[seg["predictedEtaMs"] > 0]
        seg["pred_s"] = seg["predictedEtaMs"] / 1000.0
        seg["act_s"] = seg["actualElapsedMs"] / 1000.0
        seg["err_s"] = seg["act_s"] - seg["pred_s"]

    print(f"Parsed: {len(seg)} segment timings, "
          f"{len(sections.get('CRASH MARKERS', []))} crash markers, "
          f"{len(sections.get('SAMPLES', []))} samples\n")
    print(f"Generating charts in {args.outdir.resolve()}/")

    if not seg.empty:
        m = accuracy_metrics(seg["pred_s"].to_numpy(), seg["act_s"].to_numpy())
        print("\nPredictive-accuracy metrics (digital twin vs actual):")
        print(f"  transits   : {m['n']}")
        print(f"  R^2        : {m['r2']:.3f}")
        print(f"  RMSE       : {m['rmse_s']:.2f} s")
        print(f"  MAE        : {m['mae_s']:.2f} s")
        print(f"  mean bias  : {m['mean_bias_s']:+.2f} s")
        print(f"  MAPE       : {m['mape_pct']:.1f} %\n")
        pd.DataFrame([m]).to_csv(args.outdir / "metrics_summary.csv", index=False)

        chart_predicted_vs_actual(seg, suffix, args.outdir)
        chart_error_distribution(seg, suffix, args.outdir)
        chart_residuals(seg, suffix, args.outdir)
        chart_error_by_segment(seg, suffix, args.outdir)
    else:
        print("  (no segment timings — skipping predictive-accuracy charts)")

    sm = to_frame(sections.get("SAMPLES", []), ["t", "activeShuttleCount", "crashedCount"])
    if not sm.empty:
        sm = sm.dropna(subset=["t"]).sort_values("t")
        sm["rel_s"] = (sm["t"] - sm["t"].min()) / 1000.0
        chart_activity_timeline(sm, suffix, args.outdir)

    print("\nDone.")
    if args.show:
        plt.show()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
