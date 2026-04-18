import API from "./api";

export const fetchBatchLifecycle = async (batchId) => {
  const res = await API.get(`/batches/${encodeURIComponent(batchId)}/lifecycle`);
  return res.data;
};
