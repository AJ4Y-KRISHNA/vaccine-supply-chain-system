import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import ManufacturerDashboard from "./pages/ManufacturerDashboard";
import DistributorDashboard from "./pages/DistributorDashboard";
import HospitalDashboard from "./pages/HospitalDashboard";
import ArchitectureStatus from "./pages/ArchitectureStatus";
import ManualSimulatorConsole from "./pages/ManualSimulatorConsole";
import ProtectedRoute from "./components/ProtectedRoute";
import { ToastProvider } from "./components/Toast";
import { manualSimulatorConsoleEnabled } from "./config/features";

function App() {
  return (
    <ToastProvider>
      <div role="note" className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">Software-only demo/test system. Synthetic records and placeholder inventory are not for clinical use.</div>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowed={["Admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          {manualSimulatorConsoleEnabled ? (
            <Route
              path="/admin/manual-simulator"
              element={
                <ProtectedRoute allowed={["Admin"]}>
                  <ManualSimulatorConsole />
                </ProtectedRoute>
              }
            />
          ) : null}
          <Route
            path="/manufacturer"
            element={
              <ProtectedRoute allowed={["Manufacturer"]}>
                <ManufacturerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/distributor"
            element={
              <ProtectedRoute allowed={["Distributor"]}>
                <DistributorDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hospital"
            element={
              <ProtectedRoute allowed={["Healthcare Professional"]}>
                <HospitalDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/architecture"
            element={
              <ProtectedRoute allowed={["Admin", "Manufacturer", "Distributor", "Healthcare Professional"]}>
                <ArchitectureStatus />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
