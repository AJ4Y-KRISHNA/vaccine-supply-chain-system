import React from "react";

export default function OrderAllocationFields({ order, options, distributors, value = {}, onChange }) {
  const disabled = order.status !== "Pending";
  const choices = options.filter(batch => batch.vaccineType === order.vaccineType);
  return <fieldset disabled={disabled} className="space-y-2">
    <label className="block text-xs text-[#60748f]">
      Allocate existing batch
      <select aria-label={`Batch for ${order.orderId}`} value={value.batchId || ""}
        onChange={event => onChange({ ...value, batchId: event.target.value })}
        className="mt-1 w-full rounded-lg border p-2">
        <option value="">Select a released, eligible batch</option>
        {choices.map((batch, index) => <option key={`${batch.batchId}-${index}`} value={batch.batchId}
          disabled={!batch.eligible || batch.remainingDoses < order.requestedDoses}>
          {batch.batchId} — {batch.remainingDoses} available{!batch.eligible ? ` (${batch.reasons.join(", ")})` : ""}
        </option>)}
      </select>
    </label>
    <label className="block text-xs text-[#60748f]">
      Assigned distributor
      <select aria-label={`Distributor for ${order.orderId}`} value={value.distributor || ""}
        onChange={event => onChange({ ...value, distributor: event.target.value })}
        className="mt-1 w-full rounded-lg border p-2">
        <option value="">Select a mapped distributor</option>
        {distributors.map(identity => <option key={identity} value={identity}>{identity}</option>)}
      </select>
    </label>
    {!disabled && !choices.some(b => b.eligible && b.remainingDoses >= order.requestedDoses) &&
      <p role="status" className="text-xs text-amber-800">No eligible batch with sufficient doses. Review release, ownership, quarantine and data-integrity issues before approval.</p>}
    {order.allocatedBatchId && <p className="text-xs">Allocated: {order.allocatedBatchId} / {order.shipmentId}</p>}
  </fieldset>;
}
