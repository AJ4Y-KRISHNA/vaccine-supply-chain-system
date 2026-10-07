function confusion(rows) {
  const tp = rows.filter(row => row.expected && row.detected).length;
  const fp = rows.filter(row => !row.expected && row.detected).length;
  const tn = rows.filter(row => !row.expected && !row.detected).length;
  const fn = rows.filter(row => row.expected && !row.detected).length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall ? 2 * precision * recall / (precision + recall) : null;
  return { tp, fp, tn, fn, precision, recall, f1 };
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)] : null;
}

module.exports = { confusion, quantile };
