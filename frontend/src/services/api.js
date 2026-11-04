import axios from "axios";
import { clearSession } from "./session";

const API = axios.create({
  baseURL: process.env.REACT_APP_API_BASE || "http://localhost:5000/api",
  timeout: 60000,
});

API.interceptors.response?.use(response => response, error => {
  const sent = error.config?.headers?.Authorization;
  if (error.response?.status === 401 && sent && sent === `Bearer ${sessionStorage.getItem("token")}` && !String(error.config?.url).includes("/auth/")) clearSession();
  return Promise.reject(error);
});

API.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default API;
