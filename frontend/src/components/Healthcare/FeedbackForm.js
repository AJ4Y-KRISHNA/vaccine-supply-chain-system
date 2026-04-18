import React, { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import { useToast } from "../Toast";
import {
  fetchHealthcareFeedback,
  submitHealthcareFeedback,
} from "../../services/feedback";

const categoryOptions = [
  "Side Effects",
  "Effectiveness",
  "Storage Concern",
  "Administration Issue",
  "Other",
];

const severityOptions = ["Low", "Medium", "High"];
const ageGroupOptions = ["Child", "Adult", "Senior"];

function toLocalDateTimeValue(value) {
  const date = value ? new Date(value) : new Date();
  const pad = (entry) => String(entry).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function riskTone(flag) {
  return flag ? "bg-[#fff1f1] text-[#d85a5a]" : "bg-[#e8f7ef] text-[#2ea67f]";
}

function feedbackTone(label) {
  const sentiment = String(label || "").toLowerCase();
  if (sentiment.includes("negative")) return "bg-[#fff1f1] text-[#d85a5a]";
  if (sentiment.includes("positive")) return "bg-[#e8f7ef] text-[#2ea67f]";
  return "bg-[#eef5ff] text-[#3278d7]";
}

export default function FeedbackForm({
  healthcareCenter,
  region,
  submittedBy,
  batchSuggestions = [],
  appointments = [],
  onCreated,
}) {
  const { addToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitState, setSubmitState] = useState({ type: "", message: "" });
  const [recentFeedback, setRecentFeedback] = useState([]);
  const [form, setForm] = useState(() => ({
    patientFeedbackText: "",
    feedbackCategory: "Side Effects",
    severity: "Medium",
    vaccineBatchId: batchSuggestions[0] || "",
    appointmentId: appointments[0]?.id || appointments[0]?.appointmentId || "",
    patientAgeGroup: "",
    region: region || "",
    submittedBy: submittedBy || "",
    observationDate: toLocalDateTimeValue(),
    consentToUseForAnalytics: true,
  }));

  const loadFeedback = async () => {
    try {
      setIsLoadingList(true);
      const response = await fetchHealthcareFeedback({
        healthcareCenter,
      });
      setRecentFeedback(response.records || []);
    } catch (_error) {
      setRecentFeedback([]);
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    setForm((current) => ({
      ...current,
      region: region || current.region,
      submittedBy: submittedBy || current.submittedBy,
      vaccineBatchId: current.vaccineBatchId || batchSuggestions[0] || "",
      appointmentId: current.appointmentId || appointments[0]?.id || appointments[0]?.appointmentId || "",
    }));
  }, [appointments, batchSuggestions, region, submittedBy]);

  useEffect(() => {
    loadFeedback();
    // refresh only when center changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthcareCenter]);

  const batchChoices = useMemo(
    () => Array.from(new Set(batchSuggestions.filter(Boolean))),
    [batchSuggestions]
  );

  const validate = () => {
    const nextErrors = {};
    const trimmedText = form.patientFeedbackText.trim();
    if (!trimmedText) {
      nextErrors.patientFeedbackText = "Feedback text is required.";
    } else if (trimmedText.length < 10) {
      nextErrors.patientFeedbackText = "Feedback must be at least 10 characters.";
    }
    if (!form.feedbackCategory) nextErrors.feedbackCategory = "Category is required.";
    if (!form.severity) nextErrors.severity = "Severity is required.";
    if (!form.vaccineBatchId.trim()) nextErrors.vaccineBatchId = "Batch ID is required.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const resetForm = () => {
    setForm({
      patientFeedbackText: "",
      feedbackCategory: "Side Effects",
      severity: "Medium",
      vaccineBatchId: batchChoices[0] || "",
      appointmentId: appointments[0]?.id || appointments[0]?.appointmentId || "",
      patientAgeGroup: "",
      region: region || "",
      submittedBy: submittedBy || "",
      observationDate: toLocalDateTimeValue(),
      consentToUseForAnalytics: true,
    });
    setErrors({});
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!validate()) return;

    try {
      setIsSubmitting(true);
      setSubmitState({ type: "", message: "" });
      const payload = {
        ...form,
        patientFeedbackText: form.patientFeedbackText.trim(),
        vaccineBatchId: form.vaccineBatchId.trim(),
        appointmentId: form.appointmentId.trim(),
        region: form.region.trim(),
        submittedBy: form.submittedBy.trim(),
        healthcareCenter,
      };

      const created = await submitHealthcareFeedback(payload);
      setSubmitState({
        type: "success",
        message: `Feedback saved with ${created.sentimentLabel} sentiment (${Number(created.sentimentScore || 0).toFixed(2)}).`,
      });
      addToast("success", "Feedback submitted successfully");
      resetForm();
      setIsOpen(false);
      await loadFeedback();
      onCreated?.(created);
    } catch (error) {
      const fieldErrors = error?.response?.data?.errors || {};
      setErrors(fieldErrors);
      const message = error?.response?.data?.error || "Unable to submit feedback.";
      setSubmitState({ type: "error", message });
      addToast("error", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[1.05rem] font-semibold text-slate-800">Healthcare Feedback</h4>
          <p className="mt-1 text-sm text-slate-500">
            Submit patient feedback for AI sentiment scoring and admin risk review.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadFeedback}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw size={14} className={`inline ${isLoadingList ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2f8ae0] px-4 py-2 text-sm font-semibold text-white"
          >
            <MessageSquarePlus size={16} />
            {isOpen ? "Close Feedback" : "Add Feedback"}
          </button>
        </div>
      </div>

      {submitState.message ? (
        <div
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            submitState.type === "success"
              ? "border border-emerald-100 bg-emerald-50 text-emerald-700"
              : "border border-rose-100 bg-rose-50 text-rose-700"
          }`}
        >
          {submitState.message}
        </div>
      ) : null}

      {isOpen ? (
        <form onSubmit={handleSubmit} className="mb-5 rounded-2xl border border-[#edf2f8] bg-[#f8fbff] p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Patient Feedback Text
              </label>
              <textarea
                rows={4}
                value={form.patientFeedbackText}
                onChange={(e) => setForm((current) => ({ ...current, patientFeedbackText: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                placeholder="Describe the patient or clinician feedback"
              />
              {errors.patientFeedbackText ? (
                <p className="mt-1 text-xs text-rose-600">{errors.patientFeedbackText}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Feedback Category
              </label>
              <select
                value={form.feedbackCategory}
                onChange={(e) => setForm((current) => ({ ...current, feedbackCategory: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
              >
                {categoryOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              {errors.feedbackCategory ? (
                <p className="mt-1 text-xs text-rose-600">{errors.feedbackCategory}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Severity
              </label>
              <select
                value={form.severity}
                onChange={(e) => setForm((current) => ({ ...current, severity: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
              >
                {severityOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              {errors.severity ? (
                <p className="mt-1 text-xs text-rose-600">{errors.severity}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Vaccine Batch ID
              </label>
              <input
                list="feedback-batch-options"
                value={form.vaccineBatchId}
                onChange={(e) => setForm((current) => ({ ...current, vaccineBatchId: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                placeholder="BATCH-001"
              />
              <datalist id="feedback-batch-options">
                {batchChoices.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              {errors.vaccineBatchId ? (
                <p className="mt-1 text-xs text-rose-600">{errors.vaccineBatchId}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Appointment ID (Optional)
              </label>
              <input
                list="feedback-appointment-options"
                value={form.appointmentId}
                onChange={(e) => setForm((current) => ({ ...current, appointmentId: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                placeholder="APT-1001"
              />
              <datalist id="feedback-appointment-options">
                {appointments.map((item, index) => (
                  <option key={item.id || item.appointmentId || index} value={item.id || item.appointmentId || ""} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Patient Age Group
              </label>
              <select
                value={form.patientAgeGroup}
                onChange={(e) => setForm((current) => ({ ...current, patientAgeGroup: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
              >
                <option value="">Select age group</option>
                {ageGroupOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Region
              </label>
              <input
                value={form.region}
                onChange={(e) => setForm((current) => ({ ...current, region: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Submitted By
              </label>
              <input
                value={form.submittedBy}
                onChange={(e) => setForm((current) => ({ ...current, submittedBy: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Observation Date
              </label>
              <input
                type="datetime-local"
                value={form.observationDate}
                onChange={(e) => setForm((current) => ({ ...current, observationDate: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.consentToUseForAnalytics}
              onChange={(e) => setForm((current) => ({ ...current, consentToUseForAnalytics: e.target.checked }))}
            />
            Consent to use for analytics
          </label>

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-[#2f8ae0] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSubmitting ? "Submitting..." : "Submit Feedback"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              Reset
            </button>
          </div>
        </form>
      ) : null}

      <div className="space-y-3">
        {recentFeedback.map((item) => (
          <div key={item._id} className="rounded-xl border border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${feedbackTone(item.sentimentLabel)}`}>
                {item.sentimentLabel} ({Number(item.sentimentScore || 0).toFixed(2)})
              </span>
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${riskTone(item.riskFlagContribution)}`}>
                {item.riskFlagContribution ? "Risk Contribution" : "Stable"}
              </span>
              <span className="rounded-md bg-[#f5f8fc] px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {item.feedbackCategory}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{item.patientFeedbackText}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-500">
              <span>Batch: {item.vaccineBatchId}</span>
              <span>Severity: {item.severity}</span>
              <span>Region: {item.region || "--"}</span>
              <span>Scoring: {item.scoringStatus}</span>
            </div>
          </div>
        ))}
        {!recentFeedback.length && (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {isLoadingList ? "Loading feedback..." : "No healthcare feedback submitted yet."}
          </div>
        )}
      </div>
    </div>
  );
}
