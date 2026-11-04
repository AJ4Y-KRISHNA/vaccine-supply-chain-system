import React, { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { User, Lock, Briefcase, ShieldCheck, Search, Link, Eye, EyeOff } from "lucide-react";
import { useToast } from "../components/Toast";
import API from "../services/api";
import { clearSession, notifySessionChanged } from "../services/session";

function displayRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "admin") return "Admin";
  if (normalized === "manufacturer") return "Manufacturer";
  if (normalized === "distributor") return "Distributor";
  if (normalized === "healthcare professional" || normalized === "healthcare") return "Healthcare Professional";
  return role;
}

function apiRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "healthcare professional") return "healthcare";
  return normalized;
}

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inFlight = useRef(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (!role || !username.trim() || !password) {
      setError("Enter your username, password and role to continue.");
      return;
    }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const res = await API.post("/auth/login", {
        email: username.trim(),
        password,
        role: apiRole(role),
      });
      const signedRole = displayRole(res.data.role);
      const destination = { Admin: "/admin", Manufacturer: "/manufacturer", Distributor: "/distributor", "Healthcare Professional": "/hospital" }[signedRole];
      if (!res.data.token || !destination) throw new Error("The server did not return a valid session.");
      sessionStorage.setItem("role", signedRole);
      sessionStorage.setItem("userEmail", res.data.identity?.email || username.trim());
      sessionStorage.setItem("token", res.data.token);
      if (res.data.refreshToken) {
        sessionStorage.setItem("refreshToken", res.data.refreshToken);
      } else sessionStorage.removeItem("refreshToken");
      notifySessionChanged();
      const returnTo = location.state?.verificationReturnTo;
      navigate(typeof returnTo === "string" && /^\/verify\/[^/]+$/.test(returnTo) ? returnTo : destination, { replace: true });
    } catch (err) {
      const message = "Login failed. Check your credentials, selected role and backend connection.";
      setError(message); addToast("error", message); clearSession();
    } finally { inFlight.current = false; setBusy(false); }
  };

  const handleReset = (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    setUsername("");
    setPassword("");
    setRole("");
    setError(""); setShowPassword(false); clearSession();
  };

  return (
    <div className="login-page min-h-screen bg-gradient-to-br from-[#e0d4fc] via-[#f3eeff] to-[#d6efff] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Decorative Blocks */}
      <div className="absolute top-20 left-10 w-24 h-24 bg-purple-300 rounded-lg opacity-20 transform rotate-12"></div>
      <div className="absolute bottom-20 right-10 w-32 h-32 bg-blue-300 rounded-lg opacity-20 transform -rotate-12"></div>
      <div className="absolute top-40 right-40 w-16 h-16 bg-pink-300 rounded-lg opacity-20 transform rotate-45"></div>

      <div className="max-w-5xl w-full bg-white/80 backdrop-blur-md rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white p-6 relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex flex-col items-center">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#7e42b5]">SmartVax</h1>
            <p className="mt-2 text-base md:text-lg font-semibold tracking-wide text-slate-800">
              Intelligent Vaccine Cold-Chain Monitoring &amp; Supply Management
            </p>
          </div>
          <p className="text-gray-600 mt-3 text-sm md:text-base font-medium">
            Secure, traceable operations for a software-only demonstration
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-8 items-center bg-gray-50/50 rounded-2xl p-6 border border-gray-100">
          
          {/* Left Side: Mock Illustration & Features */}
          <div className="flex-1 flex flex-col items-center justify-center space-y-6">
            <div className="relative w-64 h-64 bg-blue-50 rounded-full flex items-center justify-center border-4 border-white shadow-xl">
              {/* Central Illustration Mockup */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white p-4 rounded-xl shadow-lg flex flex-col items-center border border-gray-100">
                  <div className="text-xs font-bold text-blue-600 mb-2">VACCINE</div>
                  <ShieldCheck size={48} className="text-blue-500" />
              </div>
              
              {/* Floating decorative elements */}
              <div className="absolute left-8 top-1/2 transform -translate-y-1/2 bg-blue-100 p-2 rounded-lg shadow-sm border border-blue-200"><Link className="text-blue-500" size={24}/></div>
              <div className="absolute right-8 top-1/2 transform -translate-y-1/2 bg-purple-100 p-2 rounded-lg shadow-sm border border-purple-200"><Link className="text-purple-500" size={24}/></div>
              
              <Lock size={32} className="absolute bottom-10 right-16 text-slate-700" />
            </div>

            <div className="grid grid-cols-2 gap-4 w-full px-8">
              <div className="bg-white px-4 py-3 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center gap-2">
                <ShieldCheck className="text-green-500" />
                <span className="font-semibold text-gray-700">Secure</span>
              </div>
              <div className="bg-white px-4 py-3 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center gap-2">
                <Search className="text-blue-500" />
                <span className="font-semibold text-gray-700">Transparent</span>
              </div>
              <div className="bg-white px-4 py-3 rounded-xl shadow-sm border border-gray-100 md:col-span-2 flex items-center justify-center gap-2">
                <Link className="text-[#ff7f50]" />
                <span className="font-semibold text-gray-700">Blockchain Enabled</span>
              </div>
            </div>
          </div>

          {/* Right Side: Login Form */}
          <div className="w-full md:w-[400px]">
            <div className="bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-gray-100 relative">
              
              <h2 className="text-2xl font-bold text-[#7e42b5] text-center mb-8">Login Dashboard</h2>
              
              <form onSubmit={handleLogin} className="space-y-5">
                {location.state?.sessionMessage && !error && <p role="status" className="text-sm text-slate-600">{location.state.sessionMessage}</p>}
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
                <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">To use multiple roles at once, open this site in separate tabs and sign in to each tab with a different account. Each tab has its own session; signing out affects only that tab.</p>
                {/* Username Input */}
                <div className="relative">
                  <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                    <User size={20} />
                  </div>
                  <input
                    type="text"
                    aria-label="Username"
                    autoComplete="username"
                    disabled={busy}
                    maxLength={254}
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#7e42b5] focus:ring-1 focus:ring-[#7e42b5] transition-colors bg-gray-50 text-gray-700"
                    required
                  />
                </div>

                {/* Password Input */}
                <div className="relative">
                  <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                    <Lock size={20} />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    aria-label="Password"
                    autoComplete="current-password"
                    disabled={busy}
                    maxLength={128}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#7e42b5] focus:ring-1 focus:ring-[#7e42b5] transition-colors bg-gray-50 text-gray-700"
                    required
                  />
                  <button type="button" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>

                {/* Role Select Dropdown */}
                <div className="relative">
                  <div className="absolute left-4 top-3 text-gray-400">
                    <Briefcase size={20} />
                  </div>
                  <select
                    aria-label="Role"
                    disabled={busy}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#7e42b5] focus:ring-1 focus:ring-[#7e42b5] transition-colors bg-gray-50 text-gray-700 appearance-none"
                    required
                  >
                    <option value="" disabled>Select Role</option>
                    <option value="Admin">Admin</option>
                    <option value="Manufacturer">Manufacturer</option>
                    <option value="Distributor">Distributor</option>
                    <option value="Healthcare Professional">Healthcare Professional</option>
                  </select>
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 bg-[#7e42b5] hover:bg-[#6c369e] text-white py-3 rounded-xl font-semibold shadow-md transition-transform hover:-translate-y-0.5"
                  >
                    {busy ? "Signing in…" : "Login"}
                  </button>
                  <button
                    onClick={handleReset}
                    type="button"
                    disabled={busy}
                    className="flex-1 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 py-3 rounded-xl font-semibold shadow-sm transition-transform hover:-translate-y-0.5"
                  >
                    Reset
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
