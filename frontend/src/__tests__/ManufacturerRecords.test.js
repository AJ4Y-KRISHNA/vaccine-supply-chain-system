import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ManufacturerRecords from "../components/ManufacturerRecords";
import { fetchManufacturerWorkflow } from "../services/workflow";
jest.mock("../services/workflow", () => ({ fetchManufacturerWorkflow: jest.fn() }));
jest.mock("../components/BlockchainLog", () => ({ title }) => <p>{title}</p>);
const records = { batches: [{ batchId: "HISTORY-1", vaccineType: "Synthetic", quantity: 10, status: "Created" }], rawMaterials: [{ _id: "raw", batchId: "HISTORY-1", materialType: "Demo material", quantity: 10, status: "Received" }], certificates: [{ certificateId: "CERT-1", batchId: "HISTORY-1", predictedDemand: 0 }] };
beforeEach(() => { jest.resetAllMocks(); fetchManufacturerWorkflow.mockResolvedValue(records); });
test("history loads all scoped records and supports search and record details", async () => {
  const close = jest.fn(); render(<ManufacturerRecords mode="history" onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "View HISTORY-1" }));
  expect(screen.getByText(/Demo material/)).toBeInTheDocument();
  expect(screen.getByText("Blockchain audit: HISTORY-1")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search manufacturing records"), { target: { value: "absent" } });
  expect(screen.getByText("No matching batches.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close records" })); expect(close).toHaveBeenCalled();
});
test("full history exposes sign-offs for batches outside the recent list", async () => {
  const sign = jest.fn(); render(<ManufacturerRecords mode="history" onClose={() => {}} onSignRelease={sign} />);
  fireEvent.click(await screen.findByRole("button", { name: "View HISTORY-1" }));
  fireEvent.click(screen.getByRole("button", { name: "Production Sign" }));
  expect(sign).toHaveBeenCalledWith("HISTORY-1", "Production");
});
test("certificates expose missing confirmation without claiming clinical quality", async () => {
  render(<ManufacturerRecords mode="certificates" onClose={() => {}} />);
  expect(await screen.findByText(/CERT-1/)).toBeInTheDocument();
  expect(screen.getByText("No confirmed transaction")).toBeInTheDocument();
  expect(screen.getByText(/not clinical quality certificates/)).toBeInTheDocument();
});
test("failed records can be retried", async () => {
  fetchManufacturerWorkflow.mockRejectedValueOnce(new Error("Offline"));
  render(<ManufacturerRecords mode="history" onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
  fireEvent.click(screen.getByRole("button", { name: "Refresh records" }));
  expect(await screen.findByRole("button", { name: "View HISTORY-1" })).toBeInTheDocument();
});
