import React from "react";

export function statusToneFor(value) {
  const status = String(value || "").toLowerCase();
  if (/quarantin|critical|alert|reject|declin|fail|block|expired|unsafe|error/.test(status)) return "danger";
  if (/resolved|deliver|supplied|verified|approved|released|administered|reported|complete|cleared|normal|stable|available/.test(status)) return "success";
  if (/pending|await|review|transit|monitor|warning|updated|processing|draft/.test(status)) return "warning";
  if (/created|recorded|submitted|info/.test(status)) return "info";
  return "neutral";
}

export default function StatusBadge({ value, tone, children, className = "" }) {
  const resolvedTone = tone || statusToneFor(value ?? children);
  return <span className={`ui-status ui-status-${resolvedTone} ${className}`.trim()}>{children ?? value ?? "Unknown"}</span>;
}
