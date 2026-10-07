import React from "react";
import StatusBadge from "./StatusBadge";

export default function BatchDispositionBadge({ disposition }) {
  const status = disposition?.status || "active";
  const timestamp = disposition?.recordedAt && Number.isFinite(+new Date(disposition.recordedAt))
    ? new Date(disposition.recordedAt).toLocaleString()
    : "";

  return (
    <div className="flex flex-col items-start gap-1 text-[11px] leading-tight">
      <StatusBadge value={status}>Disposition: {status}</StatusBadge>
      {disposition?.reasonCode ? <span className="text-slate-600">{disposition.reasonCode}</span> : null}
      {timestamp ? <time className="text-slate-500" dateTime={new Date(disposition.recordedAt).toISOString()}>Recorded {timestamp}</time> : null}
    </div>
  );
}
