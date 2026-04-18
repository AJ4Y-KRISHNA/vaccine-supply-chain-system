import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import ManufacturerDashboard from "./pages/ManufacturerDashboard";
import DistributorDashboard from "./pages/DistributorDashboard";
import HospitalDashboard from "./pages/HospitalDashboard";
import ArchitectureStatus from "./pages/ArchitectureStatus";
import ProtectedRoute from "./components/ProtectedRoute";
import { ToastProvider } from "./components/Toast";

function App() {
  return (
    <ToastProvider>
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
