import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Flag, MapPinned, MessageSquareText, RefreshCw } from "lucide-react";
import { useToast } from "../Toast";
import { fetchAdminFeedback } from "../../services/feedback";

function toneForSentiment(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("negative")) return "bg-[#fff1f1] text-[#d85a5a]";
  if (value.includes("positive")) return "bg-[#e8f7ef] text-[#2ea67f]";
  return "bg-[#eef5ff] text-[#3278d7]";
}

function toneForRisk(flag) {
  return flag ? "bg-[#fff1f1] text-[#d85a5a]" : "bg-[#e8f7ef] text-[#2ea67f]";
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

export default function SentimentFeedbackPanel({ onFocusBatch, selectedAuditBatchId }) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState({
    summary: {
      totalFeedbackCount: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      flaggedCount: 0,
    },
    recentFeedback: [],
    flaggedFeedback: [],
    regionSummary: [],
    batchSummary: [],
    riskHighlights: [],
    records: [],
  });

  const loadFeedback = async (silent = false) => {
    try {
      setLoading(true);
      const response = await fetchAdminFeedback();
      setPayload(response);
    } catch (_error) {
      if (!silent) addToast("error", "Feedback analytics failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedback(true);
    // load once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summaryCards = useMemo(
    () => [
      { label: "Total Feedback", value: payload.summary.totalFeedbackCount, accent: "text-[#2d4a73]" },
      { label: "Positive", value: payload.summary.positiveCount, accent: "text-[#2ea67f]" },
      { label: "Neutral", value: payload.summary.neutralCount, accent: "text-[#3278d7]" },
      { label: "Negative", value: payload.summary.negativeCount, accent: "text-[#d85a5a]" },
      { label: "Risk Flagged", value: payload.summary.flaggedCount, accent: "text-[#c97d2c]" },
    ],
    [payload.summary]
  );

  const focusBatch = (batchId) => {
    if (!batchId) return;
    onFocusBatch?.(batchId);
  };

  return (
    <div id="admin-feedback" className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[1.05rem] font-semibold text-[#42566f]">Sentiment/Feedback</h3>
          <p className="mt-1 text-xs text-[#8aa0ba]">
            Live healthcare feedback scored by AI sentiment and surfaced with risk contribution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadFeedback()}
          className="inline-flex items-center gap-2 rounded-lg border border-[#dbe6f2] px-3 py-1.5 text-xs font-semibold text-[#4b6b90] hover:bg-[#f4f8fd]"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-[#edf2f8] bg-[#f8fbff] px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-[#8aa0ba]">{card.label}</div>
            <div className={`mt-1 text-2xl font-bold ${card.accent}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-xl border border-[#edf2f8] bg-[#f8fbff] p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#d85a5a]" />
            <h4 className="font-semibold text-[#42566f]">Risk Highlights</h4>
          </div>
          <div className="space-y-3">
            {payload.riskHighlights.map((item, index) => (
              <div key={`${item.reason}-${index}`} className="rounded-lg border border-[#fee2e2] bg-[#fff7f7] px-3 py-3 text-sm text-[#6b4f4f]">
                {item.reason}
              </div>
            ))}
            {!payload.riskHighlights.length && (
              <div className="rounded-lg border border-dashed border-[#d7e0eb] p-5 text-center text-sm text-[#9cacbf]">
                {loading ? "Building feedback highlights..." : "No feedback risks highlighted yet."}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#edf2f8] bg-[#f8fbff] p-4">
          <div className="mb-3 flex items-center gap-2">
            <MapPinned size={16} className="text-[#3278d7]" />
            <h4 className="font-semibold text-[#42566f]">Region Summary</h4>
          </div>
          <div className="space-y-3">
            {payload.regionSummary.slice(0, 5).map((item) => (
              <div key={item.region} className="rounded-lg border border-[#edf2f8] bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-[#42566f]">{item.region}</div>
                  <span className="rounded-md bg-[#eef5ff] px-2 py-1 text-[11px] font-semibold text-[#3278d7]">
                    {item.total} total
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#60748f]">
                  <span>Negative: {item.negativeCount}</span>
                  <span>Flagged: {item.flaggedCount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-[#edf2f8] bg-[#fbfdff] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Flag size={16} className="text-[#c97d2c]" />
            <h4 className="font-semibold text-[#42566f]">Flagged Feedback</h4>
          </div>
          <div className="space-y-3">
            {payload.flaggedFeedback.map((item) => (
              <button
                key={item._id}
                type="button"
                onClick={() => focusBatch(item.vaccineBatchId)}
                className={`block w-full rounded-xl border px-3 py-3 text-left transition ${
                  item.vaccineBatchId === selectedAuditBatchId
                    ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                    : "border-[#edf2f8] bg-white hover:border-[#9ec6f3] hover:bg-[#f8fbff]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${toneForSentiment(item.sentimentLabel)}`}>
                    {item.sentimentLabel} ({Number(item.sentimentScore || 0).toFixed(2)})
                  </span>
                  <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${toneForRisk(item.riskFlagContribution)}`}>
                    Risk
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#42566f]">{item.patientFeedbackText}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#60748f]">
                  <span>Batch: {item.vaccineBatchId}</span>
                  <span>Severity: {item.severity}</span>
                  <span>Region: {item.region}</span>
                </div>
                <div className="mt-2 text-[12px] text-[#8a5a5a]">
                  {(item.riskReasons || []).join(" | ") || "Risk feedback requires review"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#edf2f8] bg-[#fbfdff] p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquareText size={16} className="text-[#3278d7]" />
            <h4 className="font-semibold text-[#42566f]">Batch Summary</h4>
          </div>
          <div className="space-y-3">
            {payload.batchSummary.slice(0, 6).map((item) => (
              <button
                key={item.vaccineBatchId}
                type="button"
                onClick={() => focusBatch(item.vaccineBatchId)}
                className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                  item.vaccineBatchId === selectedAuditBatchId
                    ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                    : "border-[#edf2f8] bg-white hover:border-[#9ec6f3] hover:bg-[#f8fbff]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-[#42566f]">{item.vaccineBatchId}</span>
                  <span className="rounded-md bg-[#fef3c7] px-2 py-1 text-[11px] font-semibold text-[#a16207]">
                    {item.flaggedCount} flagged
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#60748f]">
                  <span>Total: {item.total}</span>
                  <span>Negative: {item.negativeCount}</span>
                  <span>High Severity: {item.highSeverityCount}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#edf2f8] bg-[#fbfdff] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageSquareText size={16} className="text-[#3278d7]" />
            <h4 className="font-semibold text-[#42566f]">Recent Feedback</h4>
          </div>
          <span className="text-xs font-semibold text-[#8aa0ba]">Newest first</span>
        </div>
        <div className="space-y-3">
          {payload.recentFeedback.map((item) => (
            <button
              key={item._id}
              type="button"
              onClick={() => focusBatch(item.vaccineBatchId)}
              className={`block w-full rounded-xl border px-4 py-4 text-left transition ${
                item.vaccineBatchId === selectedAuditBatchId
                  ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                  : "border-[#edf2f8] bg-white hover:border-[#9ec6f3] hover:bg-[#f8fbff]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${toneForSentiment(item.sentimentLabel)}`}>
                  {item.sentimentLabel} ({Number(item.sentimentScore || 0).toFixed(2)})
                </span>
                <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${toneForRisk(item.riskFlagContribution)}`}>
                  {item.riskFlagContribution ? "Risk Contribution" : "Stable"}
                </span>
                <span className="rounded-md bg-[#f5f8fc] px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  {item.feedbackCategory}
                </span>
              </div>

              <p className="mt-3 text-sm text-[#42566f]">{item.patientFeedbackText}</p>

              <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] text-[#60748f] md:grid-cols-2 xl:grid-cols-4">
                <span>Severity: {item.severity}</span>
                <span>Batch: {item.vaccineBatchId}</span>
                <span>Appointment: {item.appointmentId || "--"}</span>
                <span>Region: {item.region || "--"}</span>
                <span>Submitted By: {item.submittedBy || "--"}</span>
                <span>Observation: {formatDate(item.observationDate)}</span>
                <span>Scoring: {item.scoringStatus}</span>
                <span>Decision: {item.decisionEngineStatus}</span>
              </div>

              {item.riskReasons?.length ? (
                <div className="mt-3 rounded-lg bg-[#fff7f7] px-3 py-2 text-[12px] text-[#8a5a5a]">
                  {item.riskReasons.join(" | ")}
                </div>
              ) : null}
            </button>
          ))}

          {!payload.recentFeedback.length && (
            <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#a1b0c1]">
              {loading ? "Loading feedback analytics..." : "No feedback records available yet."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
