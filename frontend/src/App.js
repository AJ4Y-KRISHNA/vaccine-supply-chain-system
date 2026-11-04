import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";

import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import ManufacturerDashboard from "./pages/ManufacturerDashboard";
import DistributorDashboard from "./pages/DistributorDashboard";
import HospitalDashboard from "./pages/HospitalDashboard";
import ArchitectureStatus from "./pages/ArchitectureStatus";
import LiveShipmentPage from "./pages/LiveShipmentPage";
import ManualSimulatorConsole from "./pages/ManualSimulatorConsole";
import ProtectedRoute from "./components/ProtectedRoute";
import BatchVerifyPage from "./pages/BatchVerifyPage";
import { ToastProvider } from "./components/Toast";
import { manualSimulatorConsoleEnabled } from "./config/features";

function App() {
  return (
    <ToastProvider>
      <div role="note" className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">Software-only demo/test system. Synthetic records and placeholder inventory are not for clinical use.</div>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/verify/:batchId" element={<ProtectedRoute allowed={["Admin", "Manufacturer", "Distributor", "Healthcare Professional"]}><BatchVerifyPage /></ProtectedRoute>} />
          <Route
            path="/live-shipments"
            element={
              <ProtectedRoute allowed={["Admin", "Manufacturer", "Distributor", "Healthcare Professional"]}>
                <LiveShipmentPage />
              </ProtectedRoute>
            }
          />
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
          <Route path="*" element={<main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Page not found</h1><p className="my-4">This page is not part of the vaccine supply-chain application.</p><Link to="/" className="text-blue-700 underline">Return to sign in</Link></main>} />
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
