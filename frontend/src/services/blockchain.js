import API from "./api";

export const fetchBatchLifecycle = async (batchId) => {
  const res = await API.get(`/batches/${encodeURIComponent(batchId)}/lifecycle`);
  return res.data;
};

export const fetchBatchAuditAnchors = async (batchId) => {
  const res = await API.get("/batches/" + encodeURIComponent(batchId) + "/audit-anchors");
  return res.data;
};

export const fetchBatchOnChainTelemetry = async (batchId, { offset = 0, limit = 100 } = {}) => {
  const res = await API.get(`/batches/${encodeURIComponent(batchId)}/on-chain-telemetry`, { params: { offset, limit } });
  return res.data;
};

export const batchVerificationUrl = (batchId, evidence = null) => {
  if (!evidence?.latestReading?.transactionHash || evidence?.sensorEvidenceAnchored != null) {
    return new URL(`/verify/${encodeURIComponent(String(batchId || ""))}`, window.location.origin).toString();
  }
  const base = String(API.defaults.baseURL || "http://localhost:5000/api").replace(/\/+$/, "");
  const url = new URL(`${base}/batches/verify/${encodeURIComponent(String(batchId || ""))}`, window.location.origin);
  const reading = evidence?.latestReading;
  if (reading?.recordId && /^0x[0-9a-f]{64}$/i.test(reading.recordId) &&
      reading.digest && /^0x[0-9a-f]{64}$/i.test(reading.digest) &&
      reading.transactionHash && /^0x[0-9a-f]{64}$/i.test(reading.transactionHash) &&
      String(evidence.chainId) === "31337" && /^0x[0-9a-f]{40}$/i.test(String(evidence.contractAddress || ""))) {
    url.searchParams.set("recordId", evidence.latestReading.recordId);
    url.searchParams.set("digest", evidence.latestReading.digest);
    url.searchParams.set("transactionHash", evidence.latestReading.transactionHash);
    url.searchParams.set("chainId", String(evidence.chainId));
    url.searchParams.set("contractAddress", String(evidence.contractAddress));
  }
  return url.toString();
};

export const parseBatchVerificationCode = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    const match = url.pathname.match(/(?:^|\/)(?:batches\/)?verify\/([^/]+)\/?$/i);
    if (match) {
      const recordId = url.searchParams.get("recordId") || "";
      const digest = url.searchParams.get("digest") || "";
      const transactionHash = url.searchParams.get("transactionHash") || "";
      const chainId = url.searchParams.get("chainId") || "";
      const contractAddress = url.searchParams.get("contractAddress") || "";
      const hasAnyProof = Boolean(recordId || digest || transactionHash || chainId || contractAddress);
      const proof = hasAnyProof && /^0x[0-9a-f]{64}$/i.test(recordId) && /^0x[0-9a-f]{64}$/i.test(digest)
        && /^0x[0-9a-f]{64}$/i.test(transactionHash) && chainId === "31337" && /^0x[0-9a-f]{40}$/i.test(contractAddress)
        ? { recordId, digest, transactionHash, chainId, contractAddress } : null;
      return { batchId: decodeURIComponent(match[1]), proof, proofInvalid: hasAnyProof && !proof };
    }
  } catch (_) {
    // Fall through to a plain batch ID, which is also accepted by the form.
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(raw) ? { batchId: raw, proof: null } : null;
};

export const batchIdFromVerificationCode = (value) => parseBatchVerificationCode(value)?.batchId || "";

export const fetchBatchVerificationPayload = async (batchId) => {
  const res = await API.get(`/verify/${encodeURIComponent(batchId)}`);
  return res.data;
};

export const fetchBatchVerification = async (batchId, proof = null) => {
  const res = await API.get(proof ? `/batches/verify/${encodeURIComponent(batchId)}` : `/verify/${encodeURIComponent(batchId)}`, proof ? { params: proof } : undefined);
  return res.data;
};
