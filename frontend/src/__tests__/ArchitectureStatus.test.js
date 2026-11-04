import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ArchitectureStatus from "../pages/ArchitectureStatus";
import * as workflow from "../services/workflow";
jest.mock("../services/workflow", () => ({ fetchAdminMonitoring: jest.fn(), fetchAdminWorkflow: jest.fn(), fetchDistributorWorkflow: jest.fn(), fetchManufacturerWorkflow: jest.fn(), fetchVaccinationWorkflow: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  workflow.fetchManufacturerWorkflow.mockResolvedValue({ batches: [{ batchId: "B1" }] });
  workflow.fetchDistributorWorkflow.mockResolvedValue({ verificationQueue: [{ shipmentId: "S1" }] });
  workflow.fetchVaccinationWorkflow.mockResolvedValue({});
  workflow.fetchAdminWorkflow.mockResolvedValue({ workflow: [{ step: "Monitoring", status: "Active" }] });
  workflow.fetchAdminMonitoring.mockResolvedValue({ summary: { blockchainLogs: 2, tempAlerts: 1 } });
});
const open = role => { sessionStorage.setItem("role", role); return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArchitectureStatus /></MemoryRouter>); };

test("manufacturer sees its own live module without requesting forbidden endpoints", async () => {
  open("Manufacturer");
  const manufacturer = screen.getByRole("region", { name: "Manufacturer Module" });
  expect(await within(manufacturer).findByText("1 record available")).toBeInTheDocument();
  expect(workflow.fetchManufacturerWorkflow).toHaveBeenCalledTimes(1);
  expect(workflow.fetchAdminWorkflow).not.toHaveBeenCalled();
  expect(workflow.fetchDistributorWorkflow).not.toHaveBeenCalled();
  expect(workflow.fetchVaccinationWorkflow).not.toHaveBeenCalled();
  expect(screen.getAllByText(/Restricted to this module/)).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/manufacturer");
});

test("healthcare display role maps to its existing API and dashboard", async () => {
  open("Healthcare Professional");
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(workflow.fetchVaccinationWorkflow).toHaveBeenCalledTimes(1);
  expect(workflow.fetchManufacturerWorkflow).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/hospital");
});

test("admin partial failure shows independent modules and supports a real retry", async () => {
  workflow.fetchDistributorWorkflow.mockRejectedValueOnce(new Error("offline"));
  open("Admin");
  expect(await screen.findByRole("alert")).toHaveTextContent("Workflow unavailable");
  expect(within(screen.getByRole("region", { name: "Manufacturer Module" })).getByText("1 record available")).toBeInTheDocument();
  expect(screen.queryByText("Loading architecture status…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(workflow.fetchDistributorWorkflow).toHaveBeenCalledTimes(2);
});
