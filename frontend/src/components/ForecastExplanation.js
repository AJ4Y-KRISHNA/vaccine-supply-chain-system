import React from "react";

const number = (value, maximumFractionDigits = 0) => value == null || value === "" ? "Not available" : Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits }) : "Not available";

export default function ForecastExplanation({ forecast, loading = false }) {
  const explanation = forecast?.explanation_breakdown;

  return <details aria-busy={loading} className="ui-card mt-4 rounded-xl bg-brand-50/60 p-4 text-sm text-ink-700">
    <summary className="cursor-pointer font-semibold text-brand-900">Why this number?</summary>
    {loading ? <div role="status" className="mt-3 space-y-3" aria-label="Loading forecast explanation"><span className="sr-only">Loading forecast explanation…</span><div className="h-4 animate-pulse rounded bg-brand-100" /><div className="h-20 animate-pulse rounded-lg bg-white" /><div className="h-16 animate-pulse rounded-lg bg-white" /></div>
    : !explanation ? <div className="mt-3 rounded-lg border border-dashed border-border-strong bg-white p-4 text-ink-500"><p>The detailed explanation is unavailable for this forecast response.</p><p className="mt-1 text-xs">Refresh report data; the heuristic basis appears when the service returns it.</p></div> : <div className="mt-3 space-y-3">
      <p>{explanation.methodology}</p>
      <div className="rounded-lg border border-border-soft bg-white p-3">
        <p><span className="font-semibold">Selected baseline:</span> {explanation.selected_baseline}</p>
        <p className="mt-1"><span className="font-semibold">Selection rule:</span> {explanation.selection_basis}</p>
        <p className="mt-1"><span className="font-semibold">Calculation:</span> {explanation.calculation}</p>
        <p className="mt-1"><span className="font-semibold">Estimated demand:</span> {number(explanation.predicted_demand_doses)} doses for the supplied period</p>
        {Array.isArray(explanation.inputs) && explanation.inputs.length > 0 && <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {explanation.inputs.map((input, index) => <li key={`${input.label}-${index}`}>
            {input.label}: {input.demand_doses !== undefined ? `${number(input.demand_doses)} doses` : input.periods !== undefined ? `${number(input.periods)} periods` : `${number(input.change_doses_per_period)} doses per period`}
            {input.contribution_doses !== undefined ? ` (mean contribution ${number(input.contribution_doses, 2)} doses)` : ""}
          </li>)}
        </ul>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border-soft bg-white p-3">
          <h4 className="font-semibold">Recent volume trend</h4>
          <p className="mt-1">{explanation.recent_volume_trend?.description || "Trend summary unavailable."}</p>
          <p className="mt-1 text-xs text-slate-500">Context summary only; it is not a separate model component.</p>
        </div>
        <div className="rounded-lg border border-border-soft bg-white p-3">
          <h4 className="font-semibold">Seasonality</h4>
          <p className="mt-1">{explanation.seasonality?.description || "Seasonal influence is not reported."}</p>
        </div>
      </div>
      <div className="rounded-lg border border-border-soft bg-white p-3">
        <h4 className="font-semibold">Supply context — not part of the demand calculation</h4>
        <p className="mt-1">Scope: {explanation.supply_context?.scope || "Not available"}{explanation.supply_context?.vaccine_type ? ` (${explanation.supply_context.vaccine_type})` : ""}</p>
        <p className="mt-1">Unallocated recorded stock: {number(explanation.supply_context?.total_unallocated_stock_doses)} doses; unavailable under current eligibility checks: {number(explanation.supply_context?.unavailable_unallocated_stock_doses)} doses.</p>
        <p className="mt-1">Currently available stock: {number(explanation.supply_context?.current_available_stock_doses)} doses</p>
        <p className="mt-1">{explanation.supply_context?.stock_description || "Inventory snapshot unavailable."}</p>
        <p className="mt-1">{explanation.supply_context?.quarantine_description || "Active quarantine details unavailable."}</p>
        <p className="mt-1">{explanation.supply_context?.interpretation || "Supply context does not alter predicted demand."}</p>
      </div>
      <p className="text-xs text-slate-600">This is a transparent heuristic summary, not SHAP/LIME or model-internal interpretability. It is advisory, not a purchase, dispatch, or clinical decision.</p>
    </div>}
  </details>;
}
