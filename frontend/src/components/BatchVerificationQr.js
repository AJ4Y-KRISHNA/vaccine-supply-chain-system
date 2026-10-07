import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { batchVerificationUrl, fetchBatchVerificationPayload } from "../services/blockchain";

export default function BatchVerificationQr({ batchId }) {
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (!batchId) return null;

  const loadPayload = async (event) => {
    if (event.currentTarget.parentElement?.open || loading) return;
    setLoading(true);
    setError("");
    try { setEvidence(await fetchBatchVerificationPayload(batchId)); }
    catch (failure) { setError(failure.response?.data?.error || failure.response?.data?.message || "Could not load local-chain verification details."); }
    finally { setLoading(false); }
  };
  const verificationUrl = batchVerificationUrl(batchId, evidence);

  return (
    <details className="relative text-left">
      <summary onClick={loadPayload} className="cursor-pointer list-none rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        Show batch QR
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xl">
        <h4 className="text-sm font-semibold text-slate-800">Batch verification</h4>
        <p className="mt-1 text-xs text-slate-600">The QR opens a verification page that compares stored sensor proofs with the local-chain Merkle root. An account with batch access is required. Synthetic demonstration only.</p>
        {loading && <p role="status" className="mt-3 text-xs text-slate-600">Loading verified chain evidence…</p>}
        {error && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{error}</p>}
        {!loading && !error && evidence && <>
        <div className="mx-auto mt-3 flex w-fit rounded-lg border border-slate-100 bg-white p-2">
          <QRCodeSVG
            value={verificationUrl}
            size={168}
            level="M"
            includeMargin
            title={`Verification QR code for batch ${batchId}`}
            aria-label={`Verification QR code for batch ${batchId}`}
          />
        </div>
        <p className="mt-2 break-all rounded-md bg-slate-50 p-2 font-mono text-[10px] text-slate-600">{verificationUrl}</p>
        {evidence.sensorEvidenceAnchored != null && <p className="mt-2 text-xs font-semibold">Sensor evidence anchored: {evidence.sensorEvidenceAnchored}</p>}
        {evidence.sensorEvidenceAnchored == null && (evidence.latestReading?.transactionHash
          ? <p className="mt-2 break-all text-[10px] text-slate-600">Sensor record {evidence.latestReading.recordId}<br />SHA-256: {evidence.latestReading.digest}<br />Transaction: {evidence.latestReading.transactionHash}</p>
          : <p className="mt-2 text-[10px] text-amber-800">No confirmed legacy sensor transaction is linked yet.</p>)}
        <p className="mt-2 text-[10px] text-slate-500">This link contains no patient data. Verification reads current evidence rather than trusting the QR label; pending evidence is not verified evidence.</p>
        </>}
      </div>
    </details>
  );
}
