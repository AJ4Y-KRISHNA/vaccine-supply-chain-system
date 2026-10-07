import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { SESSION_EVENT, sessionExpired } from "../services/session";

const ProtectedRoute = ({ children, allowed }) => {
  const [, update] = useState(0);
  const location = useLocation();
  const redirectState = useMemo(() => ({ sessionMessage: "Please sign in with the appropriate role to continue.",
    verificationReturnTo: location.pathname.startsWith("/verify/") ? location.pathname : undefined }), [location.pathname]);
  useEffect(() => {
    const refresh = () => update(value => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener(SESSION_EVENT, refresh);
    const timer = setInterval(refresh, 30000);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(SESSION_EVENT, refresh); clearInterval(timer); };
  }, []);
  const role = String(sessionStorage.getItem("role") || "").toLowerCase();
  const allowedRoles = (allowed || []).map((entry) => String(entry).toLowerCase());
  const token = sessionStorage.getItem("token");
  if (!token || sessionExpired(token) || !role || (allowedRoles.length && !allowedRoles.includes(role))) {
    return <Navigate to="/" replace state={redirectState} />;
  }
  // A same-role account change must discard the previous account's component data.
  return <React.Fragment key={token}>{children}</React.Fragment>;
};

export default ProtectedRoute;
