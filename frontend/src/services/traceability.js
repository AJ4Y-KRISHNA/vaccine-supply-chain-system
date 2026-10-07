import API from "./api";

export const fetchTraceabilityBatches = async () => (await API.get("/traceability/batches")).data;
export const fetchBatchJourney = async batchId => (await API.get(`/batches/${encodeURIComponent(batchId)}/story`)).data;
export const fetchSystemReadiness = async () => (await API.get("/admin/readiness")).data;
export const fetchColdChainReviewers = async () => (await API.get("/admin/cold-chain/reviewers")).data;
export const setColdChainReviewer = async (userId, payload) =>
  (await API.patch(`/admin/cold-chain/reviewers/${encodeURIComponent(userId)}`, payload)).data;
