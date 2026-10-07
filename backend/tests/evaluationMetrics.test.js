const { confusion, quantile } = require("../services/evaluationMetrics");

describe("synthetic evaluation metric helpers", () => {
  test("computes precision, recall and F1 from labelled scenario results", () => {
    expect(confusion([
      { expected: true, detected: true }, { expected: true, detected: false },
      { expected: false, detected: true }, { expected: false, detected: false },
    ])).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5, f1: 0.5 });
  });

  test("uses nearest-rank percentiles and reports an empty sample as unavailable", () => {
    expect(quantile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(quantile([40, 10, 30, 20], 0.95)).toBe(40);
    expect(quantile([], 0.95)).toBeNull();
  });

  test("does not claim positive-class precision or recall from a true-negative-only sample", () => {
    expect(confusion([{ expected: false, detected: false }])).toMatchObject({ tn: 1, precision: null, recall: null, f1: null });
  });
});
