import React from "react";

const number = (value, maximumFractionDigits = 0) => value == null || value === "" ? "Not available" : Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits }) : "Not available";

export default function ForecastExplanation({ forecast }) {
  const explanation = forecast?.explanation_breakdown;

  return <details className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-slate-700">
    <summary className="cursor-pointer font-semibold text-emerald-950">Why this number?</summary>
    {!explanation ? <p className="mt-3">The detailed explanation is unavailable for this forecast response.</p> : <div className="mt-3 space-y-3">
      <p>{explanation.methodology}</p>
      <div className="rounded-lg bg-white p-3">
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
        <div className="rounded-lg bg-white p-3">
          <h4 className="font-semibold">Recent volume trend</h4>
          <p className="mt-1">{explanation.recent_volume_trend?.description || "Trend summary unavailable."}</p>
          <p className="mt-1 text-xs text-slate-500">Context summary only; it is not a separate model component.</p>
        </div>
        <div className="rounded-lg bg-white p-3">
          <h4 className="font-semibold">Seasonality</h4>
          <p className="mt-1">{explanation.seasonality?.description || "Seasonal influence is not reported."}</p>
        </div>
      </div>
      <div className="rounded-lg bg-white p-3">
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
