import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Blocks, CalendarClock, ExternalLink, MapPin, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { fetchBatchAuditAnchors, fetchBatchLifecycle, fetchBatchOnChainTelemetry } from "../services/blockchain";

function shortAddress(value) {
  if (!value) return "--";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatTimestamp(value) {
  if (!value) return "--";
  return new Date(Number(value) * 1000).toLocaleString();
}

const toneByRole = {
  Manufacturer: "from-[#2f7fd4] to-[#68aaf4]",
  Distributor: "from-[#2ea67f] to-[#53c69b]",
  "Vaccination Center": "from-[#db8e2f] to-[#f3bb63]",
  Admin: "from-[#8c5adf] to-[#b88df4]",
};

const explorerBase = (process.env.REACT_APP_BLOCKCHAIN_EXPLORER_BASE || "").replace(/\/$/, "");

function explorerLink(type, value) {
  if (!explorerBase || !value) return "";
  return `${explorerBase}/${type}/${value}`;
}

export default function BlockchainLog({
  title = "Blockchain Audit Timeline",
  batchIds = [],
  initialBatchId = "",
  selectedBatchId: controlledBatchId,
  onBatchChange,
  emptyMessage = "No blockchain-audited batches available yet.",
  enableSearch = false,
  pollingMs = 15000,
}) {
  const uniqueBatchIds = useMemo(
    () => Array.from(new Set((batchIds || []).filter(Boolean))),
    [batchIds]
  );
  const [internalBatchId, setInternalBatchId] = useState(initialBatchId || uniqueBatchIds[0] || "");
  const [refreshKey, setRefreshKey] = useState(0);
  const [audit, setAudit] = useState(null);
  const [anchorEntries, setAnchorEntries] = useState([]);
  const [anchorError, setAnchorError] = useState("");
  const [chainTelemetry, setChainTelemetry] = useState(null);
  const [chainTelemetryError, setChainTelemetryError] = useState("");
  const [chainTelemetryLoading, setChainTelemetryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const selectedBatchId = controlledBatchId !== undefined ? controlledBatchId : internalBatchId;

  const updateSelectedBatchId = useCallback((value) => {
    setInternalBatchId(value);
    if (onBatchChange) {
      onBatchChange(value);
    }
  }, [onBatchChange]);

  const filteredBatchIds = useMemo(() => {
    if (!enableSearch || !searchValue.trim()) return uniqueBatchIds;
    const needle = searchValue.trim().toLowerCase();
    return uniqueBatchIds.filter((batchId) => batchId.toLowerCase().includes(needle));
  }, [enableSearch, searchValue, uniqueBatchIds]);

  const timelineEntries = useMemo(
    () => audit?.timeline || audit?.lifecycle || [],
    [audit]
  );
  useEffect(() => {
    if (enableSearch && searchValue.trim() && filteredBatchIds.length && !filteredBatchIds.includes(selectedBatchId)) {
      updateSelectedBatchId(filteredBatchIds[0]);
    }
  }, [enableSearch, searchValue, filteredBatchIds, selectedBatchId, updateSelectedBatchId]);

  useEffect(() => {
    if (!uniqueBatchIds.length) {
      if (internalBatchId) setInternalBatchId("");
      if (audit !== null) setAudit(null);
      if (anchorEntries.length) setAnchorEntries([]);
      if (chainTelemetry !== null) setChainTelemetry(null);
      return;
    }

    if (!selectedBatchId || !uniqueBatchIds.includes(selectedBatchId)) {
      updateSelectedBatchId(initialBatchId && uniqueBatchIds.includes(initialBatchId) ? initialBatchId : uniqueBatchIds[0]);
    }
  }, [uniqueBatchIds, initialBatchId, selectedBatchId, updateSelectedBatchId, internalBatchId, audit, anchorEntries, chainTelemetry]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!selectedBatchId) {
        setAudit(null);
        setAnchorEntries([]);
        setChainTelemetry(null);
        setLoading(false); setError("");
        setAnchorError("");
        setChainTelemetryError("");
        return;
      }

      try {
        setLoading(true);
        setAudit(null);
        setAnchorEntries([]);
        setChainTelemetry(null);
        setError("");
        setAnchorError("");
        setChainTelemetryError("");
        const [lifecycleResult, anchorsResult, chainTelemetryResult] = await Promise.allSettled([
          fetchBatchLifecycle(selectedBatchId),
          fetchBatchAuditAnchors(selectedBatchId),
          fetchBatchOnChainTelemetry(selectedBatchId),
        ]);
        if (cancelled) return;
        if (lifecycleResult.status === "fulfilled") setAudit(lifecycleResult.value);
        else {
          setError(lifecycleResult.reason?.response?.data?.error || "Unable to load blockchain timeline. Check the backend and local blockchain, then refresh.");
          setAudit(null);
        }
        if (anchorsResult.status === "fulfilled") setAnchorEntries(anchorsResult.value?.entries || []);
        else setAnchorError(anchorsResult.reason?.response?.data?.error || "Cold-chain history anchor status is unavailable.");
        if (chainTelemetryResult.status === "fulfilled") setChainTelemetry(chainTelemetryResult.value);
        else setChainTelemetryError(chainTelemetryResult.reason?.response?.data?.error || "Direct on-chain sensor history is unavailable.");
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.response?.data?.error || "Unable to load blockchain timeline. Check the backend and local blockchain, then refresh.");
          setAudit(null);
          setAnchorError("Cold-chain history anchor status is unavailable.");
          setChainTelemetryError("Direct on-chain sensor history is unavailable.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedBatchId, refreshKey]);

  const loadMoreChainTelemetry = async () => {
    if (chainTelemetryLoading || chainTelemetry?.nextOffset == null || !selectedBatchId) return;
    setChainTelemetryLoading(true);
    setChainTelemetryError("");
    try {
      const page = await fetchBatchOnChainTelemetry(selectedBatchId, { offset: chainTelemetry.nextOffset });
      setChainTelemetry(current => current?.batchId === page.batchId
        ? { ...page, readings: [...current.readings, ...page.readings] }
        : page);
    } catch (failure) { setChainTelemetryError(failure.response?.data?.error || "Could not load the next on-chain history page."); }
    finally { setChainTelemetryLoading(false); }
  };

  useEffect(() => {
    if (!selectedBatchId || !pollingMs) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") setRefreshKey((value) => value + 1);
    }, pollingMs);
    return () => window.clearInterval(interval);
  }, [selectedBatchId, pollingMs]);

  return (
    <div className="rounded-[14px] border border-[#e5edf7] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-[1.05rem] font-semibold text-[#42566f]">{title}</h3>
          <p className="mt-1 text-[12px] text-[#8a9ab0]">Direct from the configured local Hardhat lifecycle history for the selected batch.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {enableSearch && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8aa0ba]" size={15} />
              <input
                type="text"
                aria-label="Search blockchain batches"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search batch"
                className="w-40 rounded-xl border border-[#dfe7f1] bg-white py-2 pl-9 pr-3 text-sm text-[#42566f] outline-none"
              />
            </div>
          )}
          <select
            className="min-w-0 max-w-full rounded-xl border border-[#dfe7f1] bg-white px-3 py-2 text-sm text-[#42566f] outline-none"
            aria-label="Blockchain batch"
            value={filteredBatchIds.includes(selectedBatchId) ? selectedBatchId : ""}
            onChange={(e) => updateSelectedBatchId(e.target.value)}
            disabled={!filteredBatchIds.length}
          >
            {filteredBatchIds.length ? (
              filteredBatchIds.map((batchId) => (
                <option key={batchId} value={batchId}>
                  {batchId}
                </option>
              ))
            ) : (
              <option value="">No batches</option>
            )}
          </select>
          <button
            type="button"
            disabled={loading || !selectedBatchId || !filteredBatchIds.length}
            onClick={() => setRefreshKey((value) => value + 1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfe7f1] text-[#5b7ba6]"
            title="Refresh timeline"
            aria-label="Refresh blockchain timeline"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {!filteredBatchIds.length && enableSearch && uniqueBatchIds.length > 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-[#d9e3ef] bg-[#f9fbfe] px-4 py-8 text-center text-sm text-[#9aaabd]">
          No batches match that search.
        </div>
      )}

      {!uniqueBatchIds.length && (
        <div className="mt-5 rounded-xl border border-dashed border-[#d9e3ef] bg-[#f9fbfe] px-4 py-8 text-center text-sm text-[#9aaabd]">
          {emptyMessage}
        </div>
      )}

      {error && uniqueBatchIds.length > 0 && (
        <div role="alert" className="mt-5 rounded-xl border border-[#ffe0e0] bg-[#fff6f6] px-4 py-3 text-sm text-[#d25b5b]">
          {error}
        </div>
      )}

      {loading && filteredBatchIds.length > 0 && <p role="status" className="mt-4 text-sm text-slate-600">Loading blockchain timeline…</p>}
      {audit && filteredBatchIds.includes(selectedBatchId) && (
        <>
          <section aria-label="Cold-chain history anchors" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-emerald-950">Cold-chain history integrity</h4>
                <p className="mt-1 max-w-3xl text-xs text-emerald-900">New sensor values and proofs stay in MongoDB; local Hardhat stores Merkle roots for five-minute / 100-reading windows. Legacy raw-chain records and audit digests remain readable. Verification is a synthetic local demonstration, not clinical assurance.</p>
              </div>
              <span className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900">{anchorEntries.filter(entry => entry.merkle ? entry.merkle.verified : entry.kind === "temperature-reading" ? entry.rawChain?.verified : entry.verified).length} verified · {anchorEntries.filter(entry => entry.merkle ? entry.merkle.anchored === "pending" : entry.kind === "temperature-reading" ? entry.rawChain?.status !== "confirmed" : !entry.anchor || entry.anchor.status === "pending").length} pending · {anchorEntries.filter(entry => entry.merkle ? entry.merkle.anchored === "no" : entry.kind === "temperature-reading" ? entry.rawChain?.status === "failed" || (entry.rawChain?.status === "confirmed" && !entry.rawChain?.verified) : entry.anchor?.status === "failed" || (entry.anchor?.status === "confirmed" && !entry.verified)).length} needs attention</span>
            </div>
            {anchorError && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">{anchorError}</p>}
            {!anchorError && !anchorEntries.length && <p className="mt-3 text-xs text-slate-700">No temperature readings or audit events are available for anchoring on this batch yet. The system readiness panel shows whether anchoring is enabled.</p>}
            {!!anchorEntries.length && <div className="mt-3 max-h-64 space-y-2 overflow-auto">
              {anchorEntries.map((entry) => {
                const rawEntry = entry.kind === "temperature-reading";
                const verified = entry.merkle ? entry.merkle.verified : rawEntry ? entry.rawChain?.verified : entry.verified;
                const status = verified ? "Verified on local chain"
                  : entry.merkle ? `Merkle evidence: ${entry.merkle.anchored}`
                    : rawEntry && !entry.rawChain?.status ? "Raw record not anchored (older entry)"
                    : rawEntry && entry.rawChain?.status === "failed" ? "Raw record write failed"
                      : rawEntry && entry.rawChain?.status === "confirmed" ? "Raw record confirmation not verified"
                        : entry.anchor?.status === "failed" ? "Digest anchor failed"
                          : entry.anchor?.status === "confirmed" ? "Digest confirmation not verified"
                            : "Waiting for anchor";
                const reading = entry.rawChain?.reading;
                return <article key={entry.kind + "-" + entry.recordId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs">
                  <div><p className="font-semibold text-slate-800">{entry.merkle ? "Sensor Merkle proof" : rawEntry ? "Raw temperature record" : entry.action || "Cold-chain audit digest"}</p>
                    <p className="mt-0.5 text-slate-500">{entry.recordedAt ? new Date(entry.recordedAt).toLocaleString() : "Time unavailable"} · {status}</p></div>
                  <div className="text-right">
                    {entry.merkle?.root && <p className="break-all font-mono text-slate-600">Root {shortAddress(entry.merkle.root)} · Gas/reading {Number(entry.merkle.gasPerReading).toFixed(2)}</p>}
                    {(rawEntry ? entry.rawChain?.txHash : entry.anchor?.txHash) ? <p className="font-mono text-slate-600" title={rawEntry ? entry.rawChain.txHash : entry.anchor.txHash}>Tx {shortAddress(rawEntry ? entry.rawChain.txHash : entry.anchor.txHash)}</p> : null}
                    {(rawEntry ? entry.rawChain?.digest : entry.anchor?.digest) ? <p className="font-mono text-slate-500" title={rawEntry ? entry.rawChain.digest : entry.anchor.digest}>Digest {shortAddress(rawEntry ? entry.rawChain.digest : entry.anchor.digest)}</p> : null}
                    {reading && <p className="mt-1 text-slate-600">{reading.temperature}°C{reading.humidity == null ? "" : ` · ${reading.humidity}% RH`}{reading.batteryLevel == null ? "" : ` · ${reading.batteryLevel}% battery`}</p>}
                  </div>
                </article>;
              })}
            </div>}
            {chainTelemetryError && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">{chainTelemetryError}</p>}
            {chainTelemetry && <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-800">Read sensor history directly from local contract ({chainTelemetry.total} records)</summary>
              <p className="mt-2 text-[11px] text-slate-500">Chain {chainTelemetry.chainId} · Contract {shortAddress(chainTelemetry.contractAddress)} · Showing records from index 0 onward.</p>
              <div className="mt-2 max-h-64 space-y-2 overflow-auto">
                {chainTelemetry.readings.map(reading => <article key={reading.recordId} className="rounded-md border border-slate-100 bg-slate-50 p-2 text-[11px]">
                  <p className="font-medium text-slate-800">{new Date(reading.recordedAt).toLocaleString()} · {reading.temperature}°C{reading.humidity == null ? "" : ` · ${reading.humidity}% RH`}{reading.batteryLevel == null ? "" : ` · ${reading.batteryLevel}% battery`}</p>
                  <p className="mt-0.5 text-slate-600">{reading.deviceId || "Device not recorded"} · {reading.vehicleId || "Vehicle not recorded"}{reading.location ? ` · GPS ${reading.location.lat}, ${reading.location.lng}` : ""}</p>
                  <p className="mt-0.5 break-all font-mono text-slate-500">{reading.digest}</p>
                </article>)}
                {!chainTelemetry.readings.length && <p className="text-xs text-slate-500">No raw sensor readings have been appended for this batch.</p>}
              </div>
              {chainTelemetry.nextOffset != null && <button type="button" disabled={chainTelemetryLoading} onClick={loadMoreChainTelemetry} className="mt-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{chainTelemetryLoading ? "Loading…" : "Load next 100 on-chain readings"}</button>}
            </details>}
          </section>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-[#ecf2f8] bg-[#f8fbff] px-4 py-3">
              <div className="flex items-center gap-2 text-[#5d7ca7]">
                <Blocks size={16} />
                <span className="text-[12px] font-semibold uppercase tracking-wide">Batch</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#33465f]">{audit.batch?.batchId || selectedBatchId}</p>
            </div>
            <div className="rounded-xl border border-[#ecf2f8] bg-[#f8fbff] px-4 py-3">
              <div className="flex items-center gap-2 text-[#5d7ca7]">
                <ShieldCheck size={16} />
                <span className="text-[12px] font-semibold uppercase tracking-wide">Status</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#33465f]">{audit.batch?.status || "--"}</p>
            </div>
            <div className="rounded-xl border border-[#ecf2f8] bg-[#f8fbff] px-4 py-3">
              <div className="flex items-center gap-2 text-[#5d7ca7]">
                <Activity size={16} />
                <span className="text-[12px] font-semibold uppercase tracking-wide">Events</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#33465f]">{audit.lifecycleCount || 0}</p>
            </div>
            <div className="rounded-xl border border-[#ecf2f8] bg-[#f8fbff] px-4 py-3">
              <div className="flex items-center gap-2 text-[#5d7ca7]">
                <CalendarClock size={16} />
                <span className="text-[12px] font-semibold uppercase tracking-wide">Actor</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#33465f]">{shortAddress(audit.batch?.manufacturer)}</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {loading && (
              <div className="rounded-xl border border-[#dfe7f1] bg-[#f9fbfe] px-4 py-3 text-sm text-[#7f93aa]">
                Refreshing blockchain timeline...
              </div>
            )}

            {timelineEntries.map((entry, index) => (
              <div key={`${entry.batchId}-${entry.timestamp}-${index}`} className="relative pl-7">
                <div className="absolute left-2 top-0 h-full w-px bg-[#dce7f3]" />
                <div className={`absolute left-0 top-2 h-4 w-4 rounded-full bg-gradient-to-br ${toneByRole[entry.actorRole] || "from-[#94a3b8] to-[#cbd5e1]"} ring-4 ring-white`} />
                <div className="rounded-xl border border-[#e8eef6] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-4 py-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[#314762]">{entry.action}</p>
                      <p className="mt-1 text-[12px] text-[#7f91a7]">
                        {entry.actorRole} - {entry.details || "Lifecycle update"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[#eef5ff] px-2.5 py-1 text-[11px] font-semibold text-[#3278d7]">
                        Qty {entry.quantity || 0}
                      </span>
                      {entry.txHash && explorerLink("tx", entry.txHash) && (
                        <a
                          href={explorerLink("tx", entry.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-[#dfe7f1] px-2.5 py-1 text-[11px] font-semibold text-[#2f8ae0] hover:underline"
                        >
                          View on chain <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] text-[#7f91a7] md:grid-cols-3">
                    <div className="flex items-center gap-2">
                      <MapPin size={13} />
                      <span>{entry.location || "--"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarClock size={13} />
                      <span>{formatTimestamp(entry.timestamp)}</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#96a7bb]">
                      {shortAddress(entry.actor)}
                      {explorerLink("address", entry.actor) && (
                        <a
                          href={explorerLink("address", entry.actor)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 inline-flex items-center gap-1 text-[#2f8ae0] hover:underline"
                        >
                          View on chain <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {!loading && !timelineEntries.length && (
              <div className="rounded-xl border border-dashed border-[#d9e3ef] bg-[#f9fbfe] px-4 py-8 text-center text-sm text-[#9aaabd]">
                No lifecycle events found on-chain for this batch yet.
              </div>
            )}

            {!!(audit.transactions || []).length && (
              <div className="rounded-xl border border-[#e8eef6] bg-[#fbfdff] px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[#42566f]">Related Transactions</h4>
                  <span className="text-[11px] text-[#8aa0ba]">{audit.transactions.length} hashes</span>
                </div>
                <div className="space-y-2">
                  {(audit.transactions || []).map((item, index) => (
                    <div
                      key={`${item.txHash}-${index}`}
                      className="flex flex-col gap-2 rounded-xl border border-[#edf2f8] bg-white px-3 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#33465f]">{item.label}</p>
                        <p className="mt-1 text-[12px] text-[#8aa0ba]">
                          {item.source} - {item.timestamp ? new Date(item.timestamp).toLocaleString() : "--"}
                        </p>
                      </div>
                      <div className="font-mono text-[11px] text-[#7f91a7]">
                        {shortAddress(item.txHash)}
                        {explorerLink("tx", item.txHash) && (
                          <a
                            href={explorerLink("tx", item.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-[#2f8ae0] hover:underline"
                          >
                            View on chain <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
