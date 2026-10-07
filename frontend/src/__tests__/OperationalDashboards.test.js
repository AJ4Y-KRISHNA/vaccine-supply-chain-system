import React from "react";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DistributorDashboard from "../pages/DistributorDashboard";
import HospitalDashboard from "../pages/HospitalDashboard";
import { fetchDistributorDashboard, fetchHealthcareDashboard } from "../services/dashboard";
import { fetchDistributorOrders, fetchVaccinationWorkflow, fetchHospitalOrders, createHospitalOrder, runVaccinationWorkflow } from "../services/workflow";
import { verifyShipment, dispatchShipment, supplyShipment } from "../services/distributorOperations";
import { downloadOperationalCsv, operationalCsv } from "../services/operationalExport";
import { vaccinationOperationId, clearVaccinationOperation } from "../services/vaccinationOperation";
jest.mock("../services/dashboard", () => ({ fetchDistributorDashboard: jest.fn(), fetchHealthcareDashboard: jest.fn() }));
jest.mock("../services/workflow", () => ({ fetchDistributorOrders: jest.fn(), fetchVaccinationWorkflow: jest.fn(), fetchHospitalOrders: jest.fn(), createHospitalOrder: jest.fn(), runVaccinationWorkflow: jest.fn(), confirmHospitalDelivery: jest.fn() }));
jest.mock("../services/distributorOperations", () => ({ verifyShipment: jest.fn(), dispatchShipment: jest.fn(), supplyShipment: jest.fn() }));
jest.mock("../services/operationalExport", () => ({ ...jest.requireActual("../services/operationalExport"), downloadOperationalCsv: jest.fn() }));
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: mockToast }) }));
jest.mock("react-chartjs-2", () => ({ Bar: () => <div>Bar chart</div>, Doughnut: () => <div>Stock chart</div> }));
jest.mock("../components/BlockchainLog", () => () => null);
jest.mock("../components/TemperatureAlertPanel", () => () => null);
jest.mock("../components/TraceabilityPanel", () => () => <div>Shipment journey panel</div>);
jest.mock("../components/Healthcare/FeedbackForm", () => () => null);
const mockToast = jest.fn();
// Full-project verification runs alongside local blockchain/AI services on
// Windows. Allow delayed React scheduling without weakening any assertion.
configure({ asyncUtilTimeout: 5000 });
beforeAll(() => {
  Object.defineProperty(window, "crypto", { configurable: true, value: require("crypto").webcrypto });
  window.TextEncoder = require("util").TextEncoder;
});
const shipment = { shipmentId: "SHIP-FRESH", batchId: "BATCH-FRESH", quantity: 10, vaccineType: "Synthetic product", destination: "Demo Hospital", status: "Pending" };
const renderPage = Page => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Page /></MemoryRouter>);
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  fetchDistributorDashboard.mockResolvedValue({ shipments: [shipment], totals: {} });
  fetchDistributorOrders.mockResolvedValue({ orders: [], notifications: [] });
  fetchHealthcareDashboard.mockResolvedValue({ identity: { hospital: "Mapped Hospital" }, cards: {}, stockDetails: [], incomingDeliveries: [] });
  fetchVaccinationWorkflow.mockResolvedValue({ requests: [], inventory: [], administrations: [], reports: [] });
  fetchHospitalOrders.mockResolvedValue({ orders: [], notifications: [] });
});

test("distributor next actions call the real service sequence and refresh displayed shipment state", async () => {
  verifyShipment.mockResolvedValue({ verification: { status: "Verified" } });
  dispatchShipment.mockResolvedValue({}); supplyShipment.mockResolvedValue({});
  renderPage(DistributorDashboard);
  const verify = await screen.findByRole("button", { name: "Verify batch" });
  fetchDistributorDashboard.mockResolvedValue({ shipments: [{ ...shipment, status: "Verified" }], totals: {} });
  fireEvent.click(verify);
  const dispatch = await screen.findByRole("button", { name: "Dispatch shipment" });
  expect(verifyShipment).toHaveBeenCalledWith("SHIP-FRESH");
  fetchDistributorDashboard.mockResolvedValue({ shipments: [{ ...shipment, status: "In Transit" }], totals: {} });
  fireEvent.click(dispatch);
  const supply = await screen.findByRole("button", { name: "Supply hospital" });
  expect(dispatchShipment).toHaveBeenCalledWith("SHIP-FRESH");
  fetchDistributorDashboard.mockResolvedValue({ shipments: [{ ...shipment, status: "Supplied to Vaccination Center" }], totals: {} });
  fireEvent.click(supply);
  await screen.findByText("Awaiting hospital receipt");
  expect(supplyShipment).toHaveBeenCalledWith("SHIP-FRESH");
});

test("search, CSV export, navigation anchors and quarantine state are functional", async () => {
  fetchDistributorDashboard.mockResolvedValue({ shipments: [{ ...shipment, coldChainStatus: "Quarantined" }], totals: {} });
  renderPage(DistributorDashboard);
  await screen.findByText("Quality hold — review required");
  expect(screen.queryByRole("button", { name: "Verify batch" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Export Report" }));
  expect(downloadOperationalCsv).toHaveBeenCalledWith("distributor-shipments.csv", expect.any(Array), expect.arrayContaining([expect.arrayContaining(["SHIP-FRESH", "BATCH-FRESH"])]));
  fireEvent.change(screen.getByLabelText("Filter shipments"), { target: { value: "unknown" } });
  expect(screen.getByText("No shipments match this search.")).toBeInTheDocument();
  for (const link of screen.getAllByRole("link")) if (link.getAttribute("href")?.startsWith("#")) expect(document.querySelector(link.getAttribute("href"))).not.toBeNull();
});

test("hospital orders validate input, bind identity server-side, and clear submitted dose input", async () => {
  createHospitalOrder.mockResolvedValue({ orderId: "ORDER-FRESH" });
  renderPage(HospitalDashboard);
  await screen.findByDisplayValue("Mapped Hospital");
  fireEvent.click(screen.getByRole("button", { name: "Submit Vaccine Order" }));
  expect(createHospitalOrder).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "Demo region" } });
  fireEvent.change(screen.getByLabelText("Vaccine type"), { target: { value: "Synthetic product" } });
  fireEvent.change(screen.getByLabelText("Requested doses"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Vaccine Order" }));
  await waitFor(() => expect(createHospitalOrder).toHaveBeenCalledTimes(1));
  expect(createHospitalOrder.mock.calls[0][0]).toMatchObject({ region: "Demo region", vaccineType: "Synthetic product", requestedDoses: 10 });
  expect(createHospitalOrder.mock.calls[0][0]).not.toHaveProperty("hospital");
  await waitFor(() => expect(screen.getByLabelText("Requested doses")).toHaveValue(null));
});

test("vaccination uses confirmed stock and cannot submit more than available", async () => {
  fetchVaccinationWorkflow.mockResolvedValue({ requests: [], reports: [], administrations: [{ _id: "A1", batchId: "B-1", dosesUsed: 3 }], inventory: [{ _id: "R1", shipmentId: "S1", batchId: "B-1", vaccineType: "Synthetic product", receivedDoses: 10, eventType: "Delivery Confirmation" }] });
  runVaccinationWorkflow.mockResolvedValue({});
  renderPage(HospitalDashboard);
  await screen.findByRole("option", { name: "B-1 — Synthetic product (7 available)" });
  fireEvent.change(screen.getByLabelText("Confirmed batch"), { target: { value: "B-1" } });
  fireEvent.change(screen.getByLabelText("Synthetic patient/reference"), { target: { value: "Class reference" } });
  fireEvent.change(screen.getByLabelText("Reporting authority"), { target: { value: "Demo authority" } });
  fireEvent.change(screen.getByLabelText("Doses used"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Record vaccination and report" }));
  expect(runVaccinationWorkflow).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Doses used"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Record vaccination and report" }));
  await waitFor(() => expect(runVaccinationWorkflow).toHaveBeenCalledTimes(1));
  expect(runVaccinationWorkflow.mock.calls[0][0]).toMatchObject({ batchId: "B-1", dosesUsed: 2, receivedDoses: 0, requestedDoses: 0 });
  expect(runVaccinationWorkflow.mock.calls[0][0]).not.toHaveProperty("stockBefore");
});

test("CSV export quotes commas and neutralizes formula input", () => {
  expect(operationalCsv(["Name"], [["=SUM(1,2)"], ['A "quote"']])).toBe('"Name"\r\n"\'=SUM(1,2)"\r\n"A ""quote"""');
});

test("vaccination identifiers survive retries, hash private inputs, and clear after confirmed success", async () => {
  sessionStorage.setItem("userEmail", "hospital@example.test");
  const payload = { batchId: "B", dosesUsed: 1, patientName: "Synthetic sensitive reference" };
  const first = await vaccinationOperationId(payload);
  expect(await vaccinationOperationId(payload)).toBe(first);
  expect(localStorage.getItem("vaccination-operations:hospital@example.test")).not.toContain(payload.patientName);
  expect(await vaccinationOperationId({ batchId: "B", dosesUsed: 2 })).not.toBe(first);
  clearVaccinationOperation(first);
  expect(await vaccinationOperationId(payload)).not.toBe(first);
  sessionStorage.setItem("userEmail", "other@example.test");
  expect(await vaccinationOperationId(payload)).not.toBe(first);
});
