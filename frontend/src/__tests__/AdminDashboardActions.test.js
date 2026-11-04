import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminDashboard from "../pages/AdminDashboard";
import * as workflow from "../services/workflow";
const mockToast = jest.fn();
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: mockToast }) }));
jest.mock("react-chartjs-2", () => ({ Doughnut: () => <div>Sentiment chart</div>, Line: () => <div>Demand chart</div> }));
jest.mock("../components/BlockchainLog", () => props => <div data-testid="audit-selection">{props.selectedBatchId}</div>);
jest.mock("../components/TemperatureAlertPanel", () => () => <div>Cold chain panel</div>);
jest.mock("../components/SimulatorPanel", () => () => <div>Simulator panel</div>);
jest.mock("../components/TraceabilityPanel", () => () => <div>Journey panel</div>);
jest.mock("../components/GuidedDemoPanel", () => () => <div>Guided demo</div>);
jest.mock("../components/SystemReadinessPanel", () => () => <div>Readiness panel</div>);
jest.mock("../components/ForecastAnalyticsPanel", () => () => <div>Regional analytics panel</div>);
jest.mock("../components/ReviewerPermissionsPanel", () => () => <div>Reviewer permissions</div>);
jest.mock("../components/Admin/SupplyPlannerPanel", () => () => <div id="admin-supply-plan">Planner panel</div>);
jest.mock("../components/Admin/SentimentFeedbackPanel", () => props => <div id="admin-feedback"><button onClick={() => props.onFocusBatch("FEEDBACK-ONLY")}>Inspect feedback batch</button></div>);
jest.mock("../services/workflow", () => ({ fetchAdminMonitoring: jest.fn(), fetchAdminOrders: jest.fn(), fetchAdminReports: jest.fn(), fetchAdminUsers: jest.fn(), fetchAdminWorkflow: jest.fn(), reviewAdminOrder: jest.fn(), runAdminSentiment: jest.fn() }));
const order = { _id: "id-1", orderId: "O1", status: "Pending", vaccineType: "Synthetic", requestedDoses: 10, hospital: "H1" };
const ordersResponse = { orders: [order], allocationOptions: [{ batchId: "B1", vaccineType: "Synthetic", remainingDoses: 50, eligible: true }], distributors: ["D1"] };

beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear();
  workflow.fetchAdminUsers.mockResolvedValue({ users: [{ _id: "U1", email: "manufacturer@test.invalid", role: "manufacturer" }, { _id: "U2", email: "hospital@test.invalid", role: "healthcare" }] });
  workflow.fetchAdminMonitoring.mockResolvedValue({ summary: { batches: 1, shipments: 0, blockchainLogs: 0, tempAlerts: 2 }, batches: [{ batchId: "B1" }], temperatureLogs: [{ _id: "T1", batchId: "B1", status: "Unknown", temperature: 5 }, { _id: "T2", batchId: "B1", status: "Normal", temperature: 4 }] });
  workflow.fetchAdminReports.mockResolvedValue({ insights: [] });
  workflow.fetchAdminWorkflow.mockResolvedValue({ workflow: [] });
  workflow.fetchAdminOrders.mockResolvedValue(ordersResponse);
  workflow.reviewAdminOrder.mockResolvedValue({});
  workflow.runAdminSentiment.mockResolvedValue({ sentiment: { sentiment: "Positive", score: 0.8 } });
  Element.prototype.scrollIntoView = jest.fn();
});
const open = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AdminDashboard /></MemoryRouter>);
const loaded = () => screen.findByText("manufacturer@test.invalid");

test("directory search filters users and feedback audit selection is not reset", async () => {
  open(); await loaded();
  fireEvent.change(screen.getByRole("textbox", { name: "Search user or role" }), { target: { value: "manufacturer" } });
  expect(screen.queryByText("hospital@test.invalid")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Inspect feedback batch" }));
  await waitFor(() => expect(screen.getByTestId("audit-selection")).toHaveTextContent("FEEDBACK-ONLY"));
});

test("empty sentiment cannot submit and submitted text is trimmed", async () => {
  open(); await loaded();
  const input = screen.getByLabelText("Text to analyze");
  const run = screen.getByRole("button", { name: "Run Sentiment Analysis" });
  fireEvent.change(input, { target: { value: "  " } });
  expect(run).toBeDisabled();
  fireEvent.change(input, { target: { value: "  Vaccines arrived on time  " } });
  fireEvent.click(run);
  await waitFor(() => expect(workflow.runAdminSentiment).toHaveBeenCalledWith("Vaccines arrived on time"));
});

test("order approval requires eligible batch and mapped distributor and submits actual inputs", async () => {
  open(); await loaded();
  const approve = screen.getByRole("button", { name: "Approve" });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Batch for O1"), { target: { value: "B1" } });
  fireEvent.change(screen.getByLabelText("Distributor for O1"), { target: { value: "D1" } });
  fireEvent.change(screen.getByLabelText("Decision note for O1"), { target: { value: "Classroom demo allocation" } });
  expect(approve).toBeEnabled();
  fireEvent.click(approve);
  await waitFor(() => expect(workflow.reviewAdminOrder).toHaveBeenCalledWith("O1", { decision: "Approve", note: "Classroom demo allocation", batchId: "B1", distributor: "D1" }));
});

test("initial API failure is visible and retry restores the section", async () => {
  workflow.fetchAdminUsers.mockRejectedValueOnce(new Error("offline"));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("User directory could not be refreshed");
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry dashboard data" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Retry dashboard data" }));
  await loaded();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("failed order refresh prevents using stale selections", async () => {
  open(); await loaded();
  fireEvent.change(screen.getByLabelText("Batch for O1"), { target: { value: "B1" } });
  fireEvent.change(screen.getByLabelText("Distributor for O1"), { target: { value: "D1" } });
  workflow.fetchAdminOrders.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(within(document.getElementById("admin-orders")).getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Order queue could not be refreshed");
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
});

test("stable filter excludes unknown readings and alert bell opens the real queue", async () => {
  open(); await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Stable" }));
  expect(screen.queryByText("Reading: 5 deg C")).not.toBeInTheDocument();
  expect(screen.getByText("Reading: 4 deg C")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open temperature alert queue" }));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
});
