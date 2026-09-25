import React from "react";

const tone = status => {
  if (status === "active") return "bg-emerald-50 text-emerald-800";
  if (status === "administered") return "bg-blue-50 text-blue-800";
  return "bg-red-50 text-red-800";
};

export default function BatchDispositionBadge({ disposition }) {
  const status = disposition?.status || "active";
  const timestamp = disposition?.recordedAt && Number.isFinite(+new Date(disposition.recordedAt))
    ? new Date(disposition.recordedAt).toLocaleString()
    : "";

  return (
    <div className="flex flex-col items-start gap-1 text-[11px] leading-tight">
      <span className={`inline-flex rounded-md px-2 py-1 font-semibold ${tone(status)}`}>
        Disposition: {status}
      </span>
      {disposition?.reasonCode ? <span className="text-slate-600">{disposition.reasonCode}</span> : null}
      {timestamp ? <time className="text-slate-500" dateTime={new Date(disposition.recordedAt).toISOString()}>Recorded {timestamp}</time> : null}
    </div>
  );
}
