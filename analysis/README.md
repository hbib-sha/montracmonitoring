# Validation charts

Python tooling that turns a recording-run CSV (exported by the Montrac
Monitoring System) into publication-quality charts comparing the digital-twin
DES predictions against actual measured data.

| File | Purpose |
|---|---|
| `generate_report_charts.py` | Reads a run CSV → writes PNG + PDF charts and `metrics_summary.csv` |
| `make_sample_data.py` | Generates a synthetic `sample_run.csv` for testing the charts |
| `requirements.txt` | Python dependencies (matplotlib, numpy, pandas) |

## 0. One-time setup

Requires **Python 3.9+**. From the repository root:

```bash
pip install -r analysis/requirements.txt
```

## A. Generate charts from the sample data (no hardware needed)

```bash
# 1. create the synthetic run CSV  ->  analysis/sample_run.csv
python analysis/make_sample_data.py

# 2. render the charts  ->  ./charts/
python analysis/generate_report_charts.py analysis/sample_run.csv --outdir charts
```

Open the files in `charts/`:

- `1_predicted_vs_actual.(png|pdf)` — predicted ETA vs actual, with the `y = x`
  line and an R²/RMSE/MAE/bias box (the core validation chart)
- `2_error_distribution` — histogram of (actual − predicted)
- `3_residuals_vs_predicted` — residual plot
- `4_error_by_segment` — mean absolute error per loop segment
- `5_activity_timeline` — active vs crashed shuttles over the run
- `metrics_summary.csv` — n, R², RMSE, MAE, bias, MAPE (numbers to cite)

`.png` = 300 dpi raster (quick view); `.pdf` = vector (best for LaTeX / papers).

### Tuning the sample data

```bash
python analysis/make_sample_data.py --laps 20 --seed 7
```

The error model lives in two constants at the top of `make_sample_data.py`:
`ERR_BEFORE_SENSOR` (segments ending at a positioning SENSOR — low, tight error)
and `ERR_OTHER` (all other segments — higher, wider error). Each is
`(mean_ms, std_ms, clip_lo_ms, clip_hi_ms)`.

## B. Generate charts from a real recorded run (later)

1. **Record a run** in the app: Reports page → *Start recording*. For a genuine
   twin-vs-reality comparison, run with **mode = real**. Let shuttles complete
   several laps, then *Stop*.
2. **Export the CSV**: Reports page → select the run → **Export CSV**. This
   downloads `run-<id>.csv` (the multi-section format the scripts expect).
3. **Render the charts**:

   ```bash
   python analysis/generate_report_charts.py path/to/run-3.csv --outdir charts_run3
   ```

### Useful flags

| Flag | Effect |
|---|---|
| `--outdir DIR` | where to write the charts (default `./charts`) |
| `--show` | also display the figures interactively |

## Notes

- If a run was recorded in **simulation** mode the script prints a warning: the
  "actual" values are themselves simulated, so use a **real-mode** run for true
  validation.
- Charts that have no data are skipped automatically (e.g. no segment timings →
  no predictive-accuracy charts).
