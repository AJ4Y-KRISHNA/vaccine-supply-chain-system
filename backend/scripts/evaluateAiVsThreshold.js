// Synthetic-only, seed-separated detector evaluation. Ground truth is emitted
// by the injected simulator scenario and never inferred from policy thresholds.
const fs = require("node:fs/promises");
const path = require("node:path");
const { VirtualDeviceSimulator } = require("../services/iotSimulator");
const { evaluateEdgeReading } = require("../edge-gateway/edgeMath");

const RUNS = Number(process.env.AI_EVAL_RUNS || 30);
const ACTIVE_TICKS = Number(process.env.AI_EVAL_TICKS || 400);
const WARMUP_TICKS = 12;
const INTERVAL_SECONDS = 60;
const TARGET_FAR = 0.01;
const EDGE_K = 2, EDGE_N = 3, EDGE_CLEAR_N = 3;
const AI_K = 2, AI_N = 3;
const cases = [
  { name: "normal", scenario: "NORMAL" }, { name: "door_open", scenario: "DOOR_OPEN" },
  { name: "compressor_drift", scenario: "COMPRESSOR_DRIFT" },
  { name: "sensor_flatline", scenario: "SENSOR_FLATLINE" }, { name: "gps_jump", scenario: "GPS_JUMP" },
];
const METHODS = ["threshold", "edge", "ai_raw", "ai_persisted"];
const FEATURES = ["temperature_ewma_deviation_c", "temperature_rate_c_per_minute",
  "temperature_rolling_z", "temperature_flatline_seconds"];

function generatedRun(scenario, seed, options = {}) {
  const intervalSeconds = options.intervalSeconds || INTERVAL_SECONDS;
  const simulator = new VirtualDeviceSimulator({
    deviceId: `SYNTHETIC-${scenario}-${seed}`, vehicleId: "SYNTHETIC-TRUCK",
    batchId: `SYNTHETIC-BATCH-${scenario}`, scenario: "NORMAL", seed,
    tickIntervalMs: intervalSeconds * 1000, startTime: "2026-01-01T00:00:00.000Z",
    temperatureRange: { min: 2, max: 8 }, noiseScale: options.noiseScale || 1,
    driftSlopeCPerMinute: options.driftSlopeCPerMinute || 0.18,
  });
  const readings = Array.from({ length: WARMUP_TICKS }, () => simulator.tick());
  simulator.setScenario(scenario);
  for (let index = 0; index < ACTIVE_TICKS; index += 1) readings.push(simulator.tick());
  return readings;
}

const toAiReading = reading => ({ temperature: reading.temperature, humidity: reading.humidity,
  latitude: reading.latitude, longitude: reading.longitude, current_timestamp: reading.timestamp,
  policy_minimum_temperature: 2, policy_maximum_temperature: 8,
  batch_id: reading.batchId, device_id: reading.deviceId });

async function scoreRun(aiBase, readings, cutoff) {
  const request = { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ readings: readings.map(toAiReading), detector_cutoff: cutoff }) };
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(`${aiBase}/anomaly/detect/run`, { ...request, signal: AbortSignal.timeout(60000) });
      if (response.ok || response.status < 500 || attempt === 3) break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  if (!response.ok) throw new Error(`AI detector returned HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json();
  if (body.readings?.length !== readings.length) throw new Error("AI detector returned an incomplete run");
  return body.readings;
}

// One dimensionless score uses the previously documented rule boundaries.
// The cutoff is calibrated on separate held-out NORMAL runs; no eval seed is used.
function edgeScores(readings) {
  let state = {};
  return readings.map(reading => {
    const evaluated = evaluateEdgeReading(reading, state, { alpha: 0.3, windowSize: 30,
      minimumTemperature: -100, maximumTemperature: 100 });
    const edge = evaluated.edge;
    const rate = edge.rateCPerMinute;
    const deviation = reading.temperature - edge.ewma;
    const featureRatios = { rollingZ: Math.abs(edge.rollingZScore) / 3,
      rateCPerMinute: Math.abs(rate) / 3, ewmaDeviationC: Math.abs(deviation) / 2.5,
      flatlineSeconds: edge.flatlineSeconds / 480 };
    state = { ...evaluated.state, latitude: reading.latitude, longitude: reading.longitude };
    return { score: Math.max(...Object.values(featureRatios)), features: featureRatios, gps: edge.gpsPlausibility };
  });
}

function calibrateUpperCutoff(values, target) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => b - a);
  if (!sorted.length) throw new Error("No held-out normal scores for calibration");
  const allowed = Math.floor(sorted.length * target);
  const boundary = sorted[Math.min(allowed, sorted.length - 1)];
  return boundary + Math.max(1, Math.abs(boundary)) * 1e-12;
}

function edgePredictions(scores, cutoff) {
  let active = false, positiveRun = 0, negativeRun = 0;
  return scores.map(({ score, features, gps }) => {
    const raw = score >= cutoff;
    if (raw) { positiveRun += 1; negativeRun = 0; if (positiveRun >= EDGE_K) active = true; }
    else { negativeRun += 1; positiveRun = 0; if (negativeRun >= EDGE_CLEAR_N) active = false; }
    return { raw: raw || gps.flagged, detected: active || gps.flagged,
      score: Math.max(score, (gps.impliedSpeedKmh || 0) / gps.maxSpeedKmh * cutoff), features };
  });
}

function rowsFor(readings, ai, edge) {
  return readings.map((r, i) => ({ truth: r.groundTruth.anomaly_active,
    truthType: r.groundTruth.anomaly_type, timestamp: new Date(r.timestamp).getTime(),
    temperature: r.temperature, onsetTick: r.simulation.scenarioStartTick,
    scores: { threshold: Number(r.temperature < 2 || r.temperature > 8),
      edge: edge[i].score, ai_raw: ai[i].ranking_score ?? 0,
      ai_persisted: ai[i].ranking_score ?? 0 },
    predictions: { threshold: r.temperature < 2 || r.temperature > 8,
      edge: edge[i].detected, edge_raw: edge[i].raw,
      ai_raw: ai[i].raw_is_anomaly === true, ai_persisted: ai[i].is_anomaly === true } }));
}

function confusion(rows, method) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of rows) {
    const p = row.predictions[method];
    if (row.truth && p) tp++; else if (!row.truth && p) fp++;
    else if (!row.truth && !p) tn++; else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, tn, fn, precision, recall,
    f1: tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
    falseAlarmRate: fp + tn ? fp / (fp + tn) : null,
    falseAlarmsPerNormalRun: null };
}

function scoreValue(row, method) { return Number(row.scores[method] || 0); }
function aucs(rows, method, prevalence = null) {
  const positives = rows.filter(row => row.truth), negatives = rows.filter(row => !row.truth);
  if (!positives.length || !negatives.length) return { prAuc: null, rocAuc: null };
  const ordered = rows.map(row => ({ row, score: scoreValue(row, method) })).sort((a, b) => b.score - a.score);
  let tp = 0, fp = 0, prevRecall = 0, pr = 0;
  const target = prevalence;
  const positiveWeight = target === null ? 1 : target / positives.length;
  const negativeWeight = target === null ? 1 : (1 - target) / negatives.length;
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].score === ordered[index].score) end++;
    let groupPos = 0, groupNeg = 0;
    for (let j = index; j < end; j++) ordered[j].row.truth ? groupPos++ : groupNeg++;
    tp += groupPos * positiveWeight; fp += groupNeg * negativeWeight;
    const recall = tp / (positives.length * positiveWeight);
    const precision = tp / (tp + fp);
    pr += (recall - prevRecall) * precision;
    prevRecall = recall; index = end;
  }
  // Mann-Whitney rank statistic with average ranks for ties.
  const ascending = rows.map(row => ({ truth: row.truth, score: scoreValue(row, method) })).sort((a, b) => a.score - b.score);
  let positiveRankSum = 0, cursor = 0;
  while (cursor < ascending.length) {
    let end = cursor + 1;
    while (end < ascending.length && ascending[end].score === ascending[cursor].score) end++;
    const averageRank = ((cursor + 1) + end) / 2;
    for (let j = cursor; j < end; j++) if (ascending[j].truth) positiveRankSum += averageRank;
    cursor = end;
  }
  const roc = (positiveRankSum - positives.length * (positives.length + 1) / 2) / (positives.length * negatives.length);
  return { prAuc: pr, rocAuc: roc };
}

function prevalenceMetrics(metrics, prevalence) {
  const recall = metrics.recall, fpr = metrics.falseAlarmRate;
  if (recall === null || fpr === null) return { prevalence, precision: null, f1: null };
  const tp = recall * prevalence, fp = fpr * (1 - prevalence);
  const precision = tp + fp ? tp / (tp + fp) : null;
  return { prevalence, precision,
    f1: precision === null || recall + precision === 0 ? null : 2 * precision * recall / (precision + recall) };
}

function firstPositive(rows, method, from = 0, through = rows.length - 1) {
  for (let i = from; i <= through; i++) if (rows[i].predictions[method]) return i;
  return -1;
}
function runMetrics(rows, method) {
  const m = confusion(rows, method), roc = aucs(rows, method);
  const onset = rows.findIndex(row => row.truth);
  const detection = onset < 0 ? -1 : firstPositive(rows, method, onset);
  const delay = detection < 0 ? null : (rows[detection].timestamp - rows[onset].timestamp) / 1000;
  const normalRows = rows.filter(row => !row.truth);
  const alarmed = normalRows.some(row => row.predictions[method]);
  let episodes = 0, active = false;
  for (const row of rows) {
    const positive = !row.truth && row.predictions[method];
    if (positive && !active) episodes++;
    active = positive;
  }
  const interval = rows.length > 1 ? rows[1].timestamp - rows[0].timestamp : 0;
  const normalHours = normalRows.length * interval / 3600000;
  const prevalence = Object.fromEntries([0.01, 0.05].map(p => [String(p), {
    ...prevalenceMetrics(m, p), prAuc: aucs(rows, method, p).prAuc,
  }]));
  return { ...m, ...roc, delaySeconds: delay, falseAlarmsPerNormalRun: alarmed ? 1 : 0,
    advisoryEpisodesPerNormalHour: normalHours > 0 ? episodes / normalHours : null,
    prevalence };
}

function meanSd(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { mean: null, standardDeviation: null, n: 0 };
  const mean = v.reduce((sum, x) => sum + x, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, standardDeviation: sd, n: v.length };
}
const METRIC_KEYS = ["precision", "recall", "f1", "falseAlarmRate", "falseAlarmsPerNormalRun", "advisoryEpisodesPerNormalHour", "delaySeconds", "prAuc", "rocAuc"];
function summarizeRuns(runs, method) {
  const byRun = runs.map(run => runMetrics(run.rows, method));
  const pooled = confusion(runs.flatMap(run => run.rows), method);
  const stats = Object.fromEntries(METRIC_KEYS.map(key => [key, meanSd(byRun.map(m => m[key]))]));
  stats.prevalence = Object.fromEntries(["0.01", "0.05"].map(p => [p,
    Object.fromEntries(["precision", "f1", "prAuc"].map(key => [key,
      meanSd(byRun.map(m => m.prevalence[p][key]))]))]));
  return { pooled, acrossRunMeanAndStandardDeviation: stats,
    detectedRuns: byRun.filter(m => m.delaySeconds !== null).length, totalRuns: runs.length };
}

function compressorTiming(runs, method) {
  const delays = [], breaches = [], leads = [];
  for (const run of runs) {
    const rows = run.rows, onset = rows.findIndex(row => row.truth);
    // Measure threshold breach from the injected onset just like detector delay.
    // Pre-injection warm-up excursions must not be counted as this run's breach.
    const breach = onset < 0 ? -1 : firstPositive(rows, "threshold", onset);
    const detection = onset < 0 ? -1 : firstPositive(rows, method, onset);
    delays.push(detection < 0 ? null : (rows[detection].timestamp - rows[onset].timestamp) / 1000);
    breaches.push(breach < 0 || onset < 0 ? null : (rows[breach].timestamp - rows[onset].timestamp) / 1000);
    leads.push(breach < 0 || detection < 0 || detection > breach ? null :
      (rows[breach].timestamp - rows[detection].timestamp) / 1000);
  }
  return { firstDetectionDelaySeconds: meanSd(delays), firstThresholdBreachSecondsAfterInjection: meanSd(breaches),
    leadTimeSecondsPositiveMeansEarlier: meanSd(leads), sameEvaluationRuns: runs.length,
    runsWithThresholdBreach: breaches.filter(Number.isFinite).length,
    runsDetectedByBreach: leads.filter(Number.isFinite).length };
}

function classBalance(runs) {
  const rows = runs.flatMap(run => run.rows);
  return { samples: rows.length, anomalyActive: rows.filter(row => row.truth).length,
    normal: rows.filter(row => !row.truth).length,
    anomalyTypes: Object.fromEntries([...new Set(rows.map(row => row.truthType).filter(Boolean))]
      .map(type => [type, rows.filter(row => row.truthType === type).length])) };
}

async function evaluateCondition(aiBase, name, scenario, options, seedPrefix, edgeCutoff, aiCutoff) {
  const runs = [];
  for (let runIndex = 0; runIndex < RUNS; runIndex++) {
    const seed = `${seedPrefix}-${name}-${String(runIndex + 1).padStart(2, "0")}`;
    const readings = generatedRun(scenario, seed, options);
    if (!readings.every(r => r.groundTruth && typeof r.groundTruth.anomaly_active === "boolean")) throw new Error(`Missing simulator label in ${seed}`);
    const ai = await scoreRun(aiBase, readings, aiCutoff);
    const edge = edgePredictions(edgeScores(readings), edgeCutoff);
    runs.push({ seed, rows: rowsFor(readings, ai, edge) });
  }
  const metrics = Object.fromEntries(METHODS.map(method => [method, summarizeRuns(runs, method)]));
  return { scenario: name, simulatorScenario: scenario, perturbation: options,
    classBalance: classBalance(runs), methods: metrics,
    ...(name === "compressor_drift" ? { compressorTiming: Object.fromEntries(METHODS.map(method => [method, compressorTiming(runs, method)])) } : {}),
    _runs: runs };
}

async function main() {
  if (!Number.isInteger(RUNS) || RUNS < 30) throw new Error("AI_EVAL_RUNS must be >= 30 for the requested 30-run evaluation");
  if (!Number.isInteger(ACTIVE_TICKS) || ACTIVE_TICKS < 300) throw new Error("AI_EVAL_TICKS must be >= 300 samples per run");
  const aiBase = process.env.AI_BASE_URL || "http://ai-service:8000";
  const jsonPath = path.resolve(process.env.RESULTS_FILE || path.join(__dirname, "../results/ai_vs_threshold.json"));
  let beforePhase11 = null;
  try {
    const old = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    beforePhase11 = old.beforePhase11 || { generatedAt: old.generatedAt,
      conditions: old.robustness.scenarios.filter(s => s.scenario === "normal" &&
        (s.perturbation.intervalSeconds === 10 || s.perturbation.noiseScale === 2)).map(s => ({
          perturbation: s.perturbation, methods: Object.fromEntries(METHODS.map(m => [m, s.methods[m].pooled.falseAlarmRate])) })) };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const calibrationRuns = 10, calibrationTicks = ACTIVE_TICKS;
  const aiCalibrationScores = [], edgeCalibrationScores = [];
  for (let run = 0; run < calibrationRuns; run++) {
    const readings = generatedRun("NORMAL", `phase11-cal-normal-${run + 1}`, { noiseScale: 1, intervalSeconds: INTERVAL_SECONDS });
    const ai = await scoreRun(aiBase, readings);
    aiCalibrationScores.push(...ai.map(item => item.detector_score).filter(Number.isFinite));
    edgeCalibrationScores.push(...edgeScores(readings).map(item => item.score));
  }
  const aiCutoff = calibrateUpperCutoff(aiCalibrationScores, TARGET_FAR);
  const edgeCutoff = calibrateUpperCutoff(edgeCalibrationScores, TARGET_FAR);
  const base = [];
  for (const item of cases) base.push(await evaluateCondition(aiBase, item.name, item.scenario,
    { noiseScale: 1, intervalSeconds: INTERVAL_SECONDS }, "phase11-eval", edgeCutoff, aiCutoff));

  // Perturbation settings never feed back into training or either cutoff.
  const robustness = [];
  for (const item of cases) for (const noiseScale of [1.5, 2]) {
    robustness.push(await evaluateCondition(aiBase, item.name, item.scenario,
      { noiseScale, intervalSeconds: INTERVAL_SECONDS }, `phase11-robust-noise${noiseScale}`, edgeCutoff, aiCutoff));
  }
  for (const item of cases) robustness.push(await evaluateCondition(aiBase, item.name, item.scenario,
    { noiseScale: 1, intervalSeconds: 10 }, "phase11-robust-10sec", edgeCutoff, aiCutoff));
  for (const driftSlopeCPerMinute of [0.09, 0.36]) robustness.push(await evaluateCondition(aiBase,
    "compressor_drift", "COMPRESSOR_DRIFT", { noiseScale: 1, intervalSeconds: INTERVAL_SECONDS, driftSlopeCPerMinute },
    `phase11-robust-drift${driftSlopeCPerMinute}`, edgeCutoff, aiCutoff));

  const scenarioReports = base.map(({ _runs, ...item }) => item);
  const overall = Object.fromEntries(METHODS.map(method => [method, summarizeRuns(base.flatMap(item => item._runs), method)]));
  const normal = base[0]._runs;
  const rawAfter = Object.fromEntries(["ai_raw", "ai_persisted"].map(method => {
    const perRun = normal.map(run => runMetrics(run.rows, method));
    const runAlarmCount = perRun.filter(item => item.falseAlarmsPerNormalRun).length;
    const sampleMetric = confusion(normal.flatMap(run => run.rows), method);
    return [method, { falseAlarmsPerNormalRun: meanSd(perRun.map(item => item.falseAlarmsPerNormalRun)),
      normalRunsWithAlarm: runAlarmCount, normalRunCount: normal.length,
      falseAlarmSamples: sampleMetric.fp, normalSamples: sampleMetric.fp + sampleMetric.tn,
      sampleFalseAlarmRate: sampleMetric.falseAlarmRate,
      advisoryEpisodesPerNormalHour: meanSd(perRun.map(item => item.advisoryEpisodesPerNormalHour)),
      firstDetectionDelaySeconds: meanSd(base.slice(1).flatMap(s => s._runs.map(r => runMetrics(r.rows, method).delaySeconds))) }];
  }));
  const robustnessReports = robustness.map(({ _runs, ...item }) => item);
  const comp = scenarioReports.find(item => item.scenario === "compressor_drift");
  const highFalseAlarmConditions = [...scenarioReports, ...robustnessReports].flatMap(s => METHODS
    .filter(m => s.methods[m].pooled.falseAlarmRate > 0.1)
    .map(m => ({ scenario: s.scenario, perturbation: s.perturbation, method: m,
      falseAlarmRate: s.methods[m].pooled.falseAlarmRate })));
  const report = {
    generatedAt: new Date().toISOString(), synthetic: true, clinicalUse: false,
    beforePhase11,
    afterPhase11: robustnessReports.filter(s => s.scenario === "normal" &&
      (s.perturbation.intervalSeconds === 10 || s.perturbation.noiseScale === 2)).map(s => ({
        perturbation: s.perturbation, methods: Object.fromEntries(METHODS.map(m => [m, s.methods[m].pooled.falseAlarmRate])) })),
    highFalseAlarmConditions,
    deployedEdgeDifference: "Shared time-based EWMA/window/rate math and immediate physical GPS rule. Deployed localAlert is an uncalibrated local temperature-threshold advisory, with no statistical hysteresis. Evaluation-only edge comparator has held-out cutoff and 2-positive/3-negative hysteresis. Neither changes approved-policy alerts.",
    protocol: { evaluationRunsPerScenario: RUNS, activeSamplesPerRun: ACTIVE_TICKS, warmupSamplesPerRun: WARMUP_TICKS,
      baseIntervalSeconds: INTERVAL_SECONDS, calibrationRuns, calibrationSeedPrefix: "phase11-cal-normal-",
      evaluationSeedPrefix: "phase11-eval-", robustnessSeedPrefixes: ["phase11-robust-noise*", "phase11-robust-10sec", "phase11-robust-drift*"],
      normalHourDefinition: "false advisory episode starts (rising edges), divided by normal samples times sampling interval / 3600; includes warm-up; not number of positive samples",
      seedsDisjoint: true, allRunSummariesUseSampleStandardDeviation: true,
      timingDefinitions: { firstDetectionDelay: "seconds from first scenario-injected positive ground-truth sample to first positive detector sample at or after it; null if never detected",
        firstThresholdBreach: "seconds from that same injection sample to the first sample outside 2–8°C; threshold is a comparator, not ground truth",
        leadTime: "threshold-breach timestamp minus first detector timestamp, only when the detector first alarms no later than the breach; positive means earlier warning" } },
    labeling: { source: "simulator-emitted per-sample groundTruth labels from scenario injection state; independent of 2–8°C policy limits",
      fields: ["groundTruth.anomaly_active", "groundTruth.anomaly_type"],
      injectedProfiles: { normal: "always inactive", door_open: "active from injection", compressor_drift: "active from injection including in-range gradual warm-up",
        sensor_flatline: "active from injection", gps_jump: "active on injected outbound jump and following return transition; independent of speed threshold" } },
    classBalance: Object.fromEntries(base.map(item => [item.scenario, item.classBalance])),
    calibration: { training: "normal-only detector feature fitting; original noise=1 and 60-second sampling settings",
      evaluationSeedSetsDisjoint: true, heldOutNormalRuns: calibrationRuns, heldOutSamples: aiCalibrationScores.length,
      targetFalseAlarmRate: TARGET_FAR,
      ai: { cutoff: aiCutoff, alarms: aiCalibrationScores.filter(value => value >= aiCutoff).length,
        observedFar: aiCalibrationScores.filter(value => value >= aiCutoff).length / aiCalibrationScores.length,
        features: FEATURES, persistence: { method: "k-of-n", k: AI_K, n: AI_N } },
      edge: { cutoff: edgeCutoff, alarms: edgeCalibrationScores.filter(value => value >= edgeCutoff).length,
        observedFar: edgeCalibrationScores.filter(value => value >= edgeCutoff).length / edgeCalibrationScores.length,
        score: "max(|30-minute rolling z|/3, |60-second bin rate °C/min|/3, |time EWMA deviation °C|/2.5, flatline seconds/480); physical GPS speed rule bypasses hysteresis",
        hysteresis: { activateAfterConsecutivePositive: EDGE_K, clearAfterConsecutiveNegative: EDGE_CLEAR_N } } },
    methods: { threshold: { description: "temperature <2°C or >8°C", role: "policy comparator, never ground-truth label" },
      edge: { description: "held-out-normal-calibrated composite edge score with 2-positive activation / 3-negative clear hysteresis", role: "advisory only" },
      ai_raw: { description: "normal-only multifeature AI score before k-of-n persistence", role: "advisory only" },
      ai_persisted: { description: "AI flag requiring 2 of the latest 3 raw positive scores", role: "advisory only; policy engine authoritative" } },
    compressorDriftTimingSameRunSet: { method: "per seed, all three times use the same scenario-injected onset and same run rows", ...comp.compressorTiming },
    aiPersistenceFalseAlarmsAndDelayBeforeAfter: rawAfter,
    scenarios: scenarioReports,
    overallFootnote: overall,
    robustness: { synthetic: true, settings: "evaluation only: noise multipliers 1.5 and 2.0 for all five scenarios; 10-second interval for all five; compressor drift slopes 0.09 and 0.36 °C/min. Training/calibration remained at original noise=1, 60-second interval, slope=0.18 °C/min.",
      scenarios: robustnessReports },
    limitations: ["All data and scenario labels are synthetic injections, not independent operational or clinical ground truth.",
      "The temperature threshold cannot detect GPS or sensor-integrity faults unless they also breach temperature limits.",
      "Realistic-prevalence precision/F1/PR-AUC values are mathematically reweighted estimates based on measured sensitivity and false-positive rate, not field prevalence samples.",
      "Edge and AI remain advisory; approved per-batch policy remains authoritative."] };
  const mdPath = path.resolve(process.env.RESULTS_MARKDOWN_FILE || path.join(path.dirname(jsonPath), "ai_vs_threshold.md"));
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const fmt = value => value === null || value === undefined ? "n/a" : Number(value).toFixed(3);
  const sd = metric => `${fmt(metric.mean)} ± ${fmt(metric.standardDeviation)}`;
  const md = ["# Phase 11 detector evaluation", "", `Generated ${report.generatedAt}. Synthetic simulation only; not for clinical use.`,
    "", `Calibration: ${calibrationRuns} held-out NORMAL runs; 1% FAR target. Evaluation: ${RUNS} runs/scenario × ${ACTIVE_TICKS} active samples, plus warm-up. Calibration and evaluation seeds are disjoint.`,
    "", "| Scenario | Method | Precision mean ± SD | Recall mean ± SD | F1 mean ± SD | Sample FAR mean ± SD | Detection delay s mean ± SD | PR-AUC mean ± SD | ROC-AUC mean ± SD | P/F1 at 1% | P/F1 at 5% |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const scenario of scenarioReports) for (const method of METHODS) {
    const m = scenario.methods[method].acrossRunMeanAndStandardDeviation;
    const prevalenceCell = p => {
      const weighted = m.prevalence[p];
      if (!Number.isFinite(weighted.precision.mean) || !Number.isFinite(weighted.f1.mean)) return "n/a / n/a";
      return `${sd(weighted.precision)} / ${sd(weighted.f1)}`;
    };
    md.push(`| ${scenario.scenario} | ${method} | ${sd(m.precision)} | ${sd(m.recall)} | ${sd(m.f1)} | ${sd(m.falseAlarmRate)} | ${sd(m.delaySeconds)} | ${sd(m.prAuc)} | ${sd(m.rocAuc)} | ${prevalenceCell("0.01")} | ${prevalenceCell("0.05")} |`);
  }
  const timing = comp.compressorTiming;
  const overallSummary = METHODS.map(method => {
    const m = overall[method].acrossRunMeanAndStandardDeviation;
    return `\`${method}\`: P ${sd(m.precision)}, R ${sd(m.recall)}, F1 ${sd(m.f1)}, FAR ${sd(m.falseAlarmRate)}, delay ${sd(m.delaySeconds)} s, PR-AUC ${sd(m.prAuc)}, ROC-AUC ${sd(m.rocAuc)}`;
  }).join("; ");
  md.push("", "For the normal-only scenario, no positive injected labels exist, so sensitivity, AUC and prevalence-weighted precision/F1 are not estimable; false-alarm metrics remain reported.",
    "", `[^overall]: Overall (secondary; mean ± SD over runs where each metric is defined): ${overallSummary}. Full pooled counts and prevalence estimates are in JSON field \`overallFootnote\`.`,
    "", "## Compressor-drift timing", "",
    "Definitions: first-detection delay is measured from injected anomaly onset to first method positive; first threshold breach is the first <2°C or >8°C sample after that same onset; lead = breach time minus detector time, positive means early warning. These are computed per identical seed/run; lead is null when no pre-breach detection. Drift labels start before temperature crosses policy, so onset-to-breach is not expected to equal detection delay.",
    "", "| Method | Detection delay (mean ± SD s) | First threshold breach (mean ± SD s after injection) | Positive lead (mean ± SD s) | Runs with breach / pre-breach detection |", "|---|---:|---:|---:|---:|");
  for (const method of METHODS) { const x = timing[method]; md.push(`| ${method} | ${sd(x.firstDetectionDelaySeconds)} | ${sd(x.firstThresholdBreachSecondsAfterInjection)} | ${sd(x.leadTimeSecondsPositiveMeansEarlier)} | ${x.runsWithThresholdBreach}/${x.runsDetectedByBreach} |`); }
  md.push("", "## AI persistence effect on normal-run false alarms", "", "| Version | False alarms per normal run (mean ± SD, 0/1) | False alarm samples / normal samples | Sample FAR |", "|---|---:|---:|---:|");
  for (const method of ["ai_raw", "ai_persisted"]) { const x = rawAfter[method]; md.push(`| ${method} | ${sd(x.falseAlarmsPerNormalRun)} | ${x.falseAlarmSamples}/${x.normalSamples} | ${fmt(x.sampleFalseAlarmRate)} |`); }
  md.push("", "## Advisory episodes per normal hour", "", "Rising-edge episodes per observed normal hour (including warm-up), not positive-sample counts.", "", "| Mode | Episodes/hour mean ± SD |", "|---|---:|");
  for (const method of ["ai_raw", "ai_persisted"]) md.push(`| ${method} | ${sd(rawAfter[method].advisoryEpisodesPerNormalHour)} |`);
  md.push("", "## Before/after timing normalization", "", "Frozen Phase 10 normal-run FAR versus Phase 11; different disjoint evaluation seeds, so not a paired causal experiment.", "", "| Setting | Method | Before sample FAR | After sample FAR |", "|---|---|---:|---:|");
  for (const after of report.afterPhase11) {
    const before = beforePhase11?.conditions.find(c => JSON.stringify(c.perturbation) === JSON.stringify(after.perturbation));
    for (const method of METHODS) md.push(`| ${JSON.stringify(after.perturbation)} | ${method} | ${fmt(before?.methods[method])} | ${fmt(after.methods[method])} |`);
  }
  md.push("", "## Limitations", "", ...report.limitations.map(x => `- ${x}`), "", report.deployedEdgeDifference,
    "", "Every measured baseline/robustness condition with pooled normal-sample FAR >10%:", "", "| Scenario / settings | Method | FAR |", "|---|---|---:|");
  for (const c of highFalseAlarmConditions) md.push(`| ${c.scenario} ${JSON.stringify(c.perturbation)} | ${c.method} | ${(c.falseAlarmRate * 100).toFixed(2)}% |`);
  if (!highFalseAlarmConditions.length) md.push("| none | — | — |");
  md.push("", "## Edge held-out calibration and robustness", "", `Edge cutoff ${fmt(edgeCutoff)}; observed held-out FAR ${fmt(report.calibration.edge.observedFar)}. AI cutoff ${fmt(aiCutoff)}; observed held-out FAR ${fmt(report.calibration.ai.observedFar)}. Robustness outcomes and mean/SD are in the JSON robustness.scenarios table. Perturbations are synthetic; detector training and calibration were not changed for them.`,
    "", "All generated telemetry and labels are synthetic. These figures do not validate vaccine safety or clinical use. Approved policies remain authoritative; AI and edge outputs are advisory.", "");
  await fs.writeFile(mdPath, md.join("\n"));
  console.log(`JSON_RESULT=${jsonPath}`); console.log(`MARKDOWN_RESULT=${mdPath}`);
  console.log(JSON.stringify({ baselineScenarios: scenarioReports.length, runsPerScenario: RUNS,
    samplesPerRun: ACTIVE_TICKS + WARMUP_TICKS, classBalance: report.classBalance,
    edgeCutoff, edgeObservedFar: report.calibration.edge.observedFar,
    aiCutoff, aiObservedFar: report.calibration.ai.observedFar,
    compressorDriftTiming: report.compressorDriftTimingSameRunSet,
    aiPersistenceFalseAlarmsAndDelayBeforeAfter: rawAfter }, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
