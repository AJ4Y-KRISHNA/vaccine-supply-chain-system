import React from "react";
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ children, allowed }) => {
  const role = String(localStorage.getItem("role") || "").toLowerCase();
  const allowedRoles = (allowed || []).map((entry) => String(entry).toLowerCase());
  if (!localStorage.getItem("token") || !role || (allowedRoles.length && !allowedRoles.includes(role))) {
    return <Navigate to="/" replace />;
  }
  return children;
};

export default ProtectedRoute;
