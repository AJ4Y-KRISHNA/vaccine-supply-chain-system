# Prototype evaluation — 2026-09-17

These results are **synthetic software checks**, not clinical validation, real vaccine-demand accuracy, a field deployment or independent research findings. All telemetry thresholds below belong to explicitly labeled test policies. None is presented as a universal storage rule.

## Explainable anomaly engine

Run `node scripts/evaluatePrototype.js` from `backend` with local MongoDB available. The script creates and removes only its isolated random test database.

Eight hand-constructed scenarios passed: normal; sustained high; sustained low; brief high; humidity excursion; critical battery; complete silence; and an unobserved gap during high readings. All seven scenarios expected to create an event did so and contained explicit reasons, recommended action and confidence basis. Sustained high and low cases quarantined at the configured 120,000 ms of **simulation time**. Brief excursions and unreliable/missing evidence did not automatically quarantine.

For quarantine classification on these eight fixtures only: TP=2, TN=6, FP=0, FN=0. This small, rule-derived set is not an estimate of clinical sensitivity/specificity or real-world false-alarm rates. Confidence denotes evidence completeness, not a probability.

100 additional sequential normal readings persisted and evaluated in 975 ms: 102.52 readings/second, median 9.75 ms and p95 11.65 ms. These are warm, single-process local measurements from one run, not a load test. Timing will vary. No missing-reading, outage-recovery or multi-worker throughput guarantee follows from these numbers.

## Demand baseline comparison

Run `python evaluate_forecast.py` from `ai-services`. The script generates a 48-period trend/seasonality/noise fixture with Python seed 1729. The exact series hash is `35efd01407a3d72d3c126ec169d7e93c980b026b2967854af9751b2ea08ff4a8`. First 36 periods form the model-selection prefix; the final 12 form chronological evaluation. Each evaluation prediction only sees earlier observations.

| Model | Evaluation MAE (dose-units) | RMSE | WAPE |
| --- | ---: | ---: | ---: |
| Last observation (selected using prefix) | 54.83 | 62.16 | 2.92% |
| Trailing-three mean | 71.92 | 84.31 | 3.83% |
| Historical drift | 52.29 | 60.01 | 2.79% |

The selected model was **not** best on the later evaluation suffix. That is a useful honest result: selection did not peek at future outcomes. Final selected forecast is 1,987 synthetic dose-units. No CNN-LSTM superiority is claimed; that module remains experimental and was not benchmarked here. No BERT accuracy is claimed; default sentiment is a labeled heuristic.

## Allocation, durability and chain evidence

- Five planning tests include 100 deterministic varied-capacity trials with no stock, demand, transport or shared-destination capacity violation. Held, unreleased, wrong-product, unknown-expiry, expired and expiry-before-arrival candidates are excluded.
- Six durable-simulator tests exercise exact deterministic restoration, pending retry after restart, failed checkpoints, concurrent controls and operator access revocation.
- Four watchdog tests cover opt-in clock anchoring, missing-first-reading evidence, normal interval alignment, pause/idempotence and failure visibility.
- Four real Hardhat contract tests cover unauthorized writes, distinct signers, duplicate registration, writer revocation and immutable/idempotent hash anchors.
- Three backend anchoring tests exercise hash canonicalization, outage/retry, live verification versus saved flags and queued-data tampering.
- The integrated local acceptance run verifies eight of eight cold-chain audit digests after the full manufacture-to-delivery flow. See SYSTEM_ACCEPTANCE.md.

## Remaining research and deployment gates

Use representative licensed, product/region-specific demand history and independently annotated cold-chain incidents before claiming real predictive or anomaly-detection accuracy. Specify independent train/validation/test periods, uncertainty/calibration, seasonal baselines, cost assumptions and external evaluation. Compare allocation objectives under realistic validated cold-storage/transport constraints, not assumed dose capacities. Add multi-process transactions/idempotency, production secret/session handling, comprehensive security review, durable independent chain infrastructure and operational recovery drills before any production use.

The delivered planner is an explainable advisory heuristic, not a globally optimal routing solver or an automatic split-order executor. The local chain is ephemeral and centrally operated. Application append-only controls are not protection from a database administrator. Raw telemetry retries can duplicate logs. No physical IoT, paid cloud/API, real clinical data or real vaccine release was used.
