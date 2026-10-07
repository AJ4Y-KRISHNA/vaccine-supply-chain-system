import React, { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, CameraOff, QrCode, Search, ShieldAlert } from "lucide-react";
import { parseBatchVerificationCode, fetchBatchVerification } from "../services/blockchain";

export default function BatchVerificationPanel({ initialCode = "" }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timeoutRef = useRef(null);
  const activeRef = useRef(false);

  const stopScanner = useCallback(() => {
    activeRef.current = false;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  useEffect(() => () => {
    activeRef.current = false;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const verifyCode = useCallback(async (value) => {
    const parsed = parseBatchVerificationCode(value);
    if (!parsed?.batchId) {
      setError("That QR is not a batch verification link. Scan the manufacturer QR or enter a batch ID.");
      setResult(null);
      return;
    }
    if (parsed.proofInvalid) {
      setError("This QR contains an incomplete or invalid local-chain proof. Scan the original QR or enter the batch ID to perform batch-only verification.");
      setResult(null);
      return;
    }
    const { batchId, proof } = parsed;
    setInput(batchId);
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const data = await fetchBatchVerification(batchId, proof);
      setResult(data);
    } catch (requestError) {
      const status = requestError.response?.status;
      const message = requestError.response?.data?.message || requestError.response?.data?.error;
      setError(status === 404
        ? (message || "Batch not found or not verifiable for this account.")
        : message || "Batch verification failed. Check your connection and access, then retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (initialCode) verifyCode(initialCode); }, [initialCode, verifyCode]);

  const startScanner = async () => {
    setError("");
    setCameraMessage("");
    if (!window.BarcodeDetector) {
      setCameraMessage("Automatic QR scanning is not supported by this browser. Enter the batch ID below instead.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Camera access is unavailable here. Use localhost/HTTPS or enter the batch ID below.");
      return;
    }
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      activeRef.current = true;
      if (!videoRef.current) throw new Error("Camera preview is unavailable");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      const scan = async () => {
        if (!activeRef.current || !videoRef.current) return;
        try {
          if (videoRef.current.readyState >= 2) {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) {
              const value = codes[0].rawValue;
              stopScanner();
              await verifyCode(value);
              return;
            }
          }
        } catch (_) {
          stopScanner();
          setCameraMessage("The camera could not read a QR code. Check camera permission or enter the batch ID below.");
          return;
        }
        timeoutRef.current = window.setTimeout(scan, 250);
      };
      timeoutRef.current = window.setTimeout(scan, 200);
    } catch (cameraError) {
      stopScanner();
      setCameraMessage(cameraError.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access or enter the batch ID below."
        : "Could not start the camera. Enter the batch ID below instead.");
    }
  };

  const submit = (event) => {
    event.preventDefault();
    stopScanner();
    verifyCode(input);
  };

  return (
    <section id="hospital-batch-verification" aria-labelledby="batch-verification-heading" className="mb-5 scroll-mt-24 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-emerald-800"><QrCode size={18} /><h3 id="batch-verification-heading" className="font-semibold text-slate-800">Scan & verify a vaccine batch</h3></div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Scan the manufacturer QR or enter its batch ID. Stored sensor evidence is checked against its Merkle proof and local-chain root; batch access rules still apply. Legacy transaction-bearing QR links remain supported.</p>
        </div>
        {!scanning
          ? <button type="button" onClick={startScanner} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"><Camera size={16} />Start camera scan</button>
          : <button type="button" onClick={stopScanner} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"><CameraOff size={16} />Stop scanning</button>}
      </div>

      {scanning && <div className="mt-4 max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Camera view for scanning a batch QR code" className="aspect-video w-full object-cover" />
        <p className="px-3 py-2 text-xs text-white">Hold the QR code inside the camera view.</p>
      </div>}
      {cameraMessage && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{cameraMessage}</p>}

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="batch-verification-code">Batch ID or QR verification URL</label>
        <input id="batch-verification-code" value={input} onChange={(event) => setInput(event.target.value)} maxLength={512} placeholder="Enter batch ID or paste the verification URL" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
        <button type="submit" disabled={loading || scanning || !input.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Search size={15} />{loading ? "Verifying…" : "Verify batch"}</button>
      </form>

      {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><ShieldAlert size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      {result?.verified && <div role="status" aria-label="Batch verification result" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 font-semibold text-emerald-900"><BadgeCheck size={19} />{result.telemetryVerified ? "Batch and sensor record verified on the local blockchain" : "Batch verified on the local blockchain"}</div>
        {result.sensorEvidenceAnchored != null && <>
          <p className={`mt-3 font-semibold ${result.integrityFailure ? "text-rose-800" : "text-slate-800"}`}>Sensor evidence anchored: {result.sensorEvidenceAnchored}</p>
          {result.integrityFailure && <p role="alert" className="mt-2 text-sm text-rose-800">Sensor verification failed: stored evidence does not match its commitment. Batch registration alone does not verify this sensor history.</p>}
          <p className="mt-2 text-sm">Readings: {result.historySummary?.count || 0} · Verified in this page: {result.verifiedReadingsInPage || 0} · Pending in this page: {result.pendingReadingsInPage || 0} · Checked up to {result.verificationLimit || 100} latest readings</p>
          {result.hasMoreReadings && <p className="mt-1 text-xs">Older readings require individual verification; this page does not claim the full history was checked.</p>}
          {result.historySummary?.count > 0 && <p className="mt-2 text-sm">Temperature range: {result.historySummary.minimum}–{result.historySummary.maximum}°C · Mean: {Number(result.historySummary.mean).toFixed(2)}°C</p>}
          <div className="mt-3 space-y-2">{(result.evidence || []).slice(0, 5).map(entry => <details key={entry.readingId} className="rounded-lg bg-white p-2 text-xs">
            <summary className="cursor-pointer">Reading {entry.readingId}: {entry.anchored}</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(entry, null, 2)}</pre>
          </details>)}</div>
          <p className="mt-3 text-xs">Distribution records: {result.distributionRecords?.length || 0} (up to 100)</p>
          {(result.distributionRecords || []).slice(0, 10).map(row => <p key={row._id} className="mt-1 text-xs">{row.targetCenter || "Destination not recorded"} · {row.supply ?? "—"} doses · {row.decision || row.blockchainStatus}</p>)}
        </>}
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-emerald-800">Batch ID</dt><dd className="font-medium text-slate-800">{result.batchId}</dd></div>
          <div><dt className="text-xs text-emerald-800">Vaccine type</dt><dd className="font-medium text-slate-800">{result.vaccineType || "Not recorded"}</dd></div>
          <div><dt className="text-xs text-emerald-800">On-chain quantity</dt><dd className="font-medium text-slate-800">{result.quantity ?? "Not recorded"}</dd></div>
          <div><dt className="text-xs text-emerald-800">On-chain status</dt><dd className="font-medium text-slate-800">{result.status || "Not recorded"}</dd></div>
          <div><dt className="text-xs text-emerald-800">{result.sensorEvidenceAnchored != null ? "Off-chain sensor readings" : "On-chain sensor readings"}</dt><dd className="font-medium text-slate-800">{result.sensorEvidenceAnchored != null ? result.historySummary?.count || 0 : result.telemetryCount ?? 0}</dd></div>
        </dl>
        {result.telemetryVerified && result.verifiedReading && <div className="mt-3 rounded-lg border border-emerald-200 bg-white/80 p-3 text-xs text-slate-700">
          <p className="font-semibold">Sensor record hash verified against the contract</p>
          <p className="mt-1">Recorded: {new Date(result.verifiedReading.recordedAt).toLocaleString()} · Temperature: {result.verifiedReading.temperature}°C{result.verifiedReading.humidity != null ? ` · Humidity: ${result.verifiedReading.humidity}%` : ""}</p>
          <p className="mt-1 break-all font-mono">{result.verifiedReading.digest}</p>
        </div>}
        <p className="mt-3 text-xs text-emerald-900">This confirms a matching record on the local demonstration blockchain only. It is not external regulator or clinical verification.</p>
      </div>}
      <p className="mt-3 text-[11px] text-slate-500">Synthetic software simulation, not for clinical or production use. Camera scanning needs permission and a supported browser API. New batch links check Merkle evidence when available; legacy full QR links check their original raw transaction.</p>
    </section>
  );
}
