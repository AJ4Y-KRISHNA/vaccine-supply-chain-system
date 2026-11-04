import React from "react";

// Kept for legacy imports. Dispatch belongs to the authenticated order workflow.
export default function DistributionForm() {
  return <section className="rounded-xl border bg-white p-5" aria-label="Distribution workflow guidance">
    <h2 className="text-lg font-semibold">Distribution workflow</h2>
    <p className="mt-2 text-sm text-slate-600">Use the administrator dashboard to review and allocate an order, then the distributor dashboard to dispatch its shipment. Batch release, ownership, available stock and cold-chain holds are checked by the server.</p>
    <p className="mt-2 text-sm text-slate-600">The legacy forecast-only distribution form is retired. No shipment is created from this notice.</p>
  </section>;
}
