import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { clearSession } from "../services/session";

export function LogoutButton({ className = "", children }) {
  const navigate = useNavigate();
  return <button type="button" className={className} onClick={() => { clearSession(); navigate("/", { replace: true }); }}>
    {children || <><LogOut size={17} aria-hidden="true" /><span>Logout</span></>}
  </button>;
}
export default function SessionControls() {
  return <div className="session-controls">
    <span className="session-identity" title={sessionStorage.getItem("userEmail") || ""}>{sessionStorage.getItem("userEmail") || "Signed-in account"}</span>
    <Link to="/architecture">System overview</Link>
    <LogoutButton />
  </div>;
}
