# Phase 11 detector evaluation

Generated 2026-10-07T05:56:27.018Z. Synthetic simulation only; not for clinical use.

Calibration: 10 held-out NORMAL runs; 1% FAR target. Evaluation: 30 runs/scenario × 400 active samples, plus warm-up. Calibration and evaluation seeds are disjoint.

| Scenario | Method | Precision mean ± SD | Recall mean ± SD | F1 mean ± SD | Sample FAR mean ± SD | Detection delay s mean ± SD | PR-AUC mean ± SD | ROC-AUC mean ± SD | P/F1 at 1% | P/F1 at 5% |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| normal | threshold | n/a ± n/a | n/a ± n/a | n/a ± n/a | 0.000 ± 0.000 | n/a ± n/a | n/a ± n/a | n/a ± n/a | n/a / n/a | n/a / n/a |
| normal | edge | 0.000 ± 0.000 | n/a ± n/a | 0.000 ± 0.000 | 0.002 ± 0.003 | n/a ± n/a | n/a ± n/a | n/a ± n/a | n/a / n/a | n/a / n/a |
| normal | ai_raw | 0.000 ± 0.000 | n/a ± n/a | 0.000 ± 0.000 | 0.009 ± 0.006 | n/a ± n/a | n/a ± n/a | n/a ± n/a | n/a / n/a | n/a / n/a |
| normal | ai_persisted | 0.000 ± 0.000 | n/a ± n/a | 0.000 ± 0.000 | 0.003 ± 0.005 | n/a ± n/a | n/a ± n/a | n/a ± n/a | n/a / n/a | n/a / n/a |
| door_open | threshold | 1.000 ± 0.000 | 1.000 ± 0.000 | 1.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | 1.000 ± 0.000 | 1.000 ± 0.000 | 1.000 ± 0.000 / 1.000 ± 0.000 | 1.000 ± 0.000 / 1.000 ± 0.000 |
| door_open | edge | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.008 ± 0.046 | n/a ± n/a | 0.971 ± 0.014 | 0.655 ± 0.115 | n/a / n/a | n/a / n/a |
| door_open | ai_raw | 0.999 ± 0.002 | 1.000 ± 0.001 | 0.999 ± 0.001 | 0.044 ± 0.081 | 6.000 ± 18.308 | 1.000 ± 0.002 | 0.997 ± 0.015 | 0.696 ± 0.438 / 0.720 ± 0.404 | 0.775 ± 0.328 / 0.828 ± 0.258 |
| door_open | ai_persisted | 0.999 ± 0.002 | 0.997 ± 0.001 | 0.998 ± 0.001 | 0.025 ± 0.079 | 62.000 ± 24.830 | 1.000 ± 0.002 | 0.997 ± 0.015 | 0.904 ± 0.292 / 0.907 ± 0.280 | 0.918 ± 0.250 / 0.930 ± 0.212 |
| compressor_drift | threshold | 1.000 ± 0.000 | 0.916 ± 0.001 | 0.956 ± 0.001 | 0.000 ± 0.000 | 2004.000 ± 29.896 | 0.998 ± 0.000 | 0.958 ± 0.001 | 1.000 ± 0.000 / 0.956 ± 0.001 | 1.000 ± 0.000 / 0.956 ± 0.001 |
| compressor_drift | edge | 1.000 ± 0.002 | 0.821 ± 0.002 | 0.902 ± 0.001 | 0.008 ± 0.046 | 4160.000 ± 786.156 | 0.998 ± 0.001 | 0.940 ± 0.019 | 0.968 ± 0.177 / 0.874 ± 0.153 | 0.972 ± 0.156 / 0.880 ± 0.119 |
| compressor_drift | ai_raw | 0.999 ± 0.002 | 0.940 ± 0.004 | 0.968 ± 0.003 | 0.044 ± 0.068 | 144.000 ± 81.266 | 1.000 ± 0.000 | 0.988 ± 0.008 | 0.664 ± 0.450 / 0.669 ± 0.402 | 0.749 ± 0.339 / 0.784 ± 0.254 |
| compressor_drift | ai_persisted | 0.999 ± 0.002 | 0.937 ± 0.004 | 0.967 ± 0.003 | 0.017 ± 0.055 | 220.000 ± 74.464 | 1.000 ± 0.000 | 0.988 ± 0.008 | 0.906 ± 0.286 / 0.883 ± 0.260 | 0.925 ± 0.229 / 0.910 ± 0.179 |
| sensor_flatline | threshold | n/a ± n/a | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | n/a ± n/a | 0.971 ± 0.000 | 0.500 ± 0.000 | n/a / n/a | n/a / n/a |
| sensor_flatline | edge | 1.000 ± 0.000 | 0.962 ± 0.000 | 0.981 ± 0.000 | 0.000 ± 0.000 | 900.000 ± 0.000 | 0.999 ± 0.001 | 0.982 ± 0.015 | 1.000 ± 0.000 / 0.981 ± 0.000 | 1.000 ± 0.000 / 0.981 ± 0.000 |
| sensor_flatline | ai_raw | 0.999 ± 0.002 | 0.990 ± 0.004 | 0.994 ± 0.002 | 0.042 ± 0.075 | 242.000 ± 100.255 | 1.000 ± 0.000 | 0.996 ± 0.003 | 0.696 ± 0.437 / 0.717 ± 0.400 | 0.777 ± 0.325 / 0.826 ± 0.251 |
| sensor_flatline | ai_persisted | 1.000 ± 0.001 | 0.987 ± 0.004 | 0.994 ± 0.002 | 0.008 ± 0.034 | 300.000 ± 104.519 | 1.000 ± 0.000 | 0.996 ± 0.003 | 0.939 ± 0.233 / 0.937 ± 0.214 | 0.954 ± 0.176 / 0.959 ± 0.135 |
| gps_jump | threshold | n/a ± n/a | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | n/a ± n/a | 0.238 ± 0.000 | 0.500 ± 0.000 | n/a / n/a | n/a / n/a |
| gps_jump | edge | 0.998 ± 0.006 | 1.000 ± 0.000 | 0.999 ± 0.003 | 0.001 ± 0.002 | 0.000 ± 0.000 | 1.000 ± 0.000 | 1.000 ± 0.000 | 0.971 ± 0.111 / 0.981 ± 0.072 | 0.991 ± 0.034 / 0.995 ± 0.018 |
| gps_jump | ai_raw | 0.975 ± 0.017 | 1.000 ± 0.000 | 0.987 ± 0.009 | 0.008 ± 0.006 | 0.000 ± 0.000 | 1.000 ± 0.000 | 1.000 ± 0.000 | 0.610 ± 0.190 / 0.742 ± 0.143 | 0.874 ± 0.079 / 0.931 ± 0.045 |
| gps_jump | ai_persisted | 0.996 ± 0.009 | 1.000 ± 0.000 | 0.998 ± 0.005 | 0.001 ± 0.003 | 0.000 ± 0.000 | 1.000 ± 0.000 | 1.000 ± 0.000 | 0.927 ± 0.157 / 0.954 ± 0.101 | 0.979 ± 0.048 / 0.989 ± 0.026 |

For the normal-only scenario, no positive injected labels exist, so sensitivity, AUC and prevalence-weighted precision/F1 are not estimable; false-alarm metrics remain reported.

[^overall]: Overall (secondary; mean ± SD over runs where each metric is defined): `threshold`: P 1.000 ± 0.000, R 0.479 ± 0.482, F1 0.489 ± 0.491, FAR 0.000 ± 0.000, delay 1002.000 ± 1010.673 s, PR-AUC 0.802 ± 0.327, ROC-AUC 0.740 ± 0.241; `edge`: P 0.918 ± 0.275, R 0.696 ± 0.409, F1 0.681 ± 0.440, FAR 0.004 ± 0.029, delay 1686.667 ± 1852.284 s, PR-AUC 0.992 ± 0.014, ROC-AUC 0.894 ± 0.152; `ai_raw`: P 0.794 ± 0.399, R 0.982 ± 0.025, F1 0.790 ± 0.396, FAR 0.030 ± 0.060, delay 98.000 ± 120.235 s, PR-AUC 1.000 ± 0.001, ROC-AUC 0.995 ± 0.010; `ai_persisted`: P 0.922 ± 0.267, R 0.981 ± 0.026, F1 0.913 ± 0.265, FAR 0.011 ± 0.046, delay 145.500 ± 136.658 s, PR-AUC 1.000 ± 0.001, ROC-AUC 0.995 ± 0.010. Full pooled counts and prevalence estimates are in JSON field `overallFootnote`.

## Compressor-drift timing

Definitions: first-detection delay is measured from injected anomaly onset to first method positive; first threshold breach is the first <2°C or >8°C sample after that same onset; lead = breach time minus detector time, positive means early warning. These are computed per identical seed/run; lead is null when no pre-breach detection. Drift labels start before temperature crosses policy, so onset-to-breach is not expected to equal detection delay.

| Method | Detection delay (mean ± SD s) | First threshold breach (mean ± SD s after injection) | Positive lead (mean ± SD s) | Runs with breach / pre-breach detection |
|---|---:|---:|---:|---:|
| threshold | 2004.000 ± 29.896 | 2004.000 ± 29.896 | 0.000 ± 0.000 | 30/30 |
| edge | 4160.000 ± 786.156 | 2004.000 ± 29.896 | 2040.000 ± 0.000 | 30/1 |
| ai_raw | 144.000 ± 81.266 | 2004.000 ± 29.896 | 1860.000 ± 90.516 | 30/30 |
| ai_persisted | 220.000 ± 74.464 | 2004.000 ± 29.896 | 1784.000 ± 77.085 | 30/30 |

## AI persistence effect on normal-run false alarms

| Version | False alarms per normal run (mean ± SD, 0/1) | False alarm samples / normal samples | Sample FAR |
|---|---:|---:|---:|
| ai_raw | 1.000 ± 0.000 | 111/12360 | 0.009 |
| ai_persisted | 0.333 ± 0.479 | 36/12360 | 0.003 |

## Advisory episodes per normal hour

Rising-edge episodes per observed normal hour (including warm-up), not positive-sample counts.

| Mode | Episodes/hour mean ± SD |
|---|---:|
| ai_raw | 0.447 ± 0.265 |
| ai_persisted | 0.073 ± 0.113 |

## Before/after timing normalization

Frozen Phase 10 normal-run FAR versus Phase 11; different disjoint evaluation seeds, so not a paired causal experiment.

| Setting | Method | Before sample FAR | After sample FAR |
|---|---|---:|---:|
| {"noiseScale":2,"intervalSeconds":60} | threshold | 0.502 | 0.499 |
| {"noiseScale":2,"intervalSeconds":60} | edge | 0.345 | 0.337 |
| {"noiseScale":2,"intervalSeconds":60} | ai_raw | 0.470 | 0.455 |
| {"noiseScale":2,"intervalSeconds":60} | ai_persisted | 0.469 | 0.447 |
| {"noiseScale":1,"intervalSeconds":10} | threshold | 0.000 | 0.000 |
| {"noiseScale":1,"intervalSeconds":10} | edge | 0.938 | 0.000 |
| {"noiseScale":1,"intervalSeconds":10} | ai_raw | 0.701 | 0.000 |
| {"noiseScale":1,"intervalSeconds":10} | ai_persisted | 0.785 | 0.000 |

## Limitations

- All data and scenario labels are synthetic injections, not independent operational or clinical ground truth.
- The temperature threshold cannot detect GPS or sensor-integrity faults unless they also breach temperature limits.
- Realistic-prevalence precision/F1/PR-AUC values are mathematically reweighted estimates based on measured sensitivity and false-positive rate, not field prevalence samples.
- Edge and AI remain advisory; approved per-batch policy remains authoritative.

Shared time-based EWMA/window/rate math and immediate physical GPS rule. Deployed localAlert is an uncalibrated local temperature-threshold advisory, with no statistical hysteresis. Evaluation-only edge comparator has held-out cutoff and 2-positive/3-negative hysteresis. Neither changes approved-policy alerts.

Every measured baseline/robustness condition with pooled normal-sample FAR >10%:

| Scenario / settings | Method | FAR |
|---|---|---:|
| normal {"noiseScale":1.5,"intervalSeconds":60} | threshold | 32.86% |
| normal {"noiseScale":1.5,"intervalSeconds":60} | edge | 11.24% |
| normal {"noiseScale":1.5,"intervalSeconds":60} | ai_raw | 21.04% |
| normal {"noiseScale":1.5,"intervalSeconds":60} | ai_persisted | 15.50% |
| normal {"noiseScale":2,"intervalSeconds":60} | threshold | 49.92% |
| normal {"noiseScale":2,"intervalSeconds":60} | edge | 33.75% |
| normal {"noiseScale":2,"intervalSeconds":60} | ai_raw | 45.49% |
| normal {"noiseScale":2,"intervalSeconds":60} | ai_persisted | 44.68% |
| door_open {"noiseScale":1.5,"intervalSeconds":60} | threshold | 32.22% |
| door_open {"noiseScale":1.5,"intervalSeconds":60} | edge | 10.56% |
| door_open {"noiseScale":1.5,"intervalSeconds":60} | ai_raw | 15.00% |
| door_open {"noiseScale":2,"intervalSeconds":60} | threshold | 48.89% |
| door_open {"noiseScale":2,"intervalSeconds":60} | edge | 28.06% |
| door_open {"noiseScale":2,"intervalSeconds":60} | ai_raw | 24.17% |
| door_open {"noiseScale":2,"intervalSeconds":60} | ai_persisted | 16.67% |
| compressor_drift {"noiseScale":1.5,"intervalSeconds":60} | threshold | 34.72% |
| compressor_drift {"noiseScale":1.5,"intervalSeconds":60} | ai_raw | 17.50% |
| compressor_drift {"noiseScale":2,"intervalSeconds":60} | threshold | 51.11% |
| compressor_drift {"noiseScale":2,"intervalSeconds":60} | edge | 28.89% |
| compressor_drift {"noiseScale":2,"intervalSeconds":60} | ai_raw | 34.44% |
| compressor_drift {"noiseScale":2,"intervalSeconds":60} | ai_persisted | 24.72% |
| sensor_flatline {"noiseScale":1.5,"intervalSeconds":60} | threshold | 29.17% |
| sensor_flatline {"noiseScale":1.5,"intervalSeconds":60} | ai_raw | 15.28% |
| sensor_flatline {"noiseScale":2,"intervalSeconds":60} | threshold | 52.22% |
| sensor_flatline {"noiseScale":2,"intervalSeconds":60} | edge | 17.22% |
| sensor_flatline {"noiseScale":2,"intervalSeconds":60} | ai_raw | 29.72% |
| sensor_flatline {"noiseScale":2,"intervalSeconds":60} | ai_persisted | 20.28% |
| gps_jump {"noiseScale":1.5,"intervalSeconds":60} | threshold | 33.22% |
| gps_jump {"noiseScale":1.5,"intervalSeconds":60} | edge | 12.06% |
| gps_jump {"noiseScale":1.5,"intervalSeconds":60} | ai_raw | 21.07% |
| gps_jump {"noiseScale":1.5,"intervalSeconds":60} | ai_persisted | 15.44% |
| gps_jump {"noiseScale":2,"intervalSeconds":60} | threshold | 49.65% |
| gps_jump {"noiseScale":2,"intervalSeconds":60} | edge | 33.91% |
| gps_jump {"noiseScale":2,"intervalSeconds":60} | ai_raw | 45.98% |
| gps_jump {"noiseScale":2,"intervalSeconds":60} | ai_persisted | 44.89% |

## Edge held-out calibration and robustness

Edge cutoff 1.833; observed held-out FAR 0.010. AI cutoff 1.078; observed held-out FAR 0.010. Robustness outcomes and mean/SD are in the JSON robustness.scenarios table. Perturbations are synthetic; detector training and calibration were not changed for them.

All generated telemetry and labels are synthetic. These figures do not validate vaccine safety or clinical use. Approved policies remain authoritative; AI and edge outputs are advisory.
