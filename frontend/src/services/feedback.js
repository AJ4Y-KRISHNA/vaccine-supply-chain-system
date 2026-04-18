import API from "./api";

export const submitHealthcareFeedback = async (payload) => {
  const res = await API.post("/feedback", payload);
  return res.data;
};

export const fetchHealthcareFeedback = async (params = {}) => {
  const res = await API.get("/feedback/healthcare", { params });
  return res.data;
};

export const fetchAdminFeedback = async () => {
  const res = await API.get("/feedback/admin");
  return res.data;
};
