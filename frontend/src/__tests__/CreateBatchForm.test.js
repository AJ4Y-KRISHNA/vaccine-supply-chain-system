import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CreateBatchForm from "../components/CreateBatchForm";
import { createManufacturerBatch } from "../services/workflow";
jest.mock("../services/workflow", () => ({ createManufacturerBatch: jest.fn() }));
const result = { batch: { batchId: "CLASS-1", vaccineType: "Synthetic product", quantity: 100, manufacturer: "Demo Maker",
  expiresAt: "2099-12-31T00:00:00.000Z", releaseStage: "Awaiting Production Sign-Off" }, warnings: [] };
const fill = () => {
  for (const [label, value] of [["Batch ID", " CLASS-1 "], ["Vaccine type / product", "Synthetic product"],
    ["Batch quantity (doses)", "100"], ["Supplier", "Test supplier"], ["Material type", "Test material"],
    ["Material quantity (whole units)", "100"], ["Expiry date (UTC)", "2099-12-31"]])
    fireEvent.change(screen.getByLabelText(`${label} *`), { target: { value } });
};
const submit = () => fireEvent.submit(screen.getByRole("form", { name: "Create vaccine batch" }));
const show = (onCreated = jest.fn().mockResolvedValue(undefined)) => {
  const onClose = jest.fn();
  render(<CreateBatchForm manufacturer="Demo Maker" onCreated={onCreated} onClose={onClose} />);
  return { onCreated, onClose };
};
beforeEach(() => { jest.resetAllMocks(); createManufacturerBatch.mockResolvedValue(result); });

test("submits typed values, future UTC expiry and no editable ownership, then refreshes", async () => {
  const { onCreated } = show();
  expect(screen.getByLabelText("Manufacturer (signed-in account)")).toHaveAttribute("readonly");
  fill(); submit();
  await screen.findByText("Batch CLASS-1 created successfully.");
  const payload = createManufacturerBatch.mock.calls[0][0];
  expect(payload).toMatchObject({ batchId: "CLASS-1", quantity: 100, materialQuantity: 100, expiresAt: result.batch.expiresAt });
  expect(payload).not.toHaveProperty("manufacturer");
  expect(payload).not.toHaveProperty("releaseVisibleToExternal");
  expect(onCreated).toHaveBeenCalledWith(result);
  expect(screen.queryByRole("button", { name: "Create batch and report" })).not.toBeInTheDocument();
});

test("required fields, positive whole quantities and future expiry are checked before posting", () => {
  show(); submit();
  expect(screen.getByText("Batch ID is required.")).toBeInTheDocument();
  expect(createManufacturerBatch).not.toHaveBeenCalled();
  fill();
  fireEvent.change(screen.getByLabelText("Batch quantity (doses) *"), { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText("Expiry date (UTC) *"), { target: { value: "2020-01-01" } });
  submit();
  expect(screen.getByText(/Batch quantity.*positive whole number/)).toBeInTheDocument();
  expect(screen.getByText(/Choose a future expiry date/)).toBeInTheDocument();
  expect(createManufacturerBatch).not.toHaveBeenCalled();
});

test("double submit sends only one request and disables cancellation during creation", async () => {
  let resolve;
  createManufacturerBatch.mockImplementation(() => new Promise(done => { resolve = done; }));
  show(); fill(); submit(); submit();
  expect(createManufacturerBatch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Creating batch…" })).toBeDisabled();
  await act(async () => { resolve(result); });
});

test("a duplicate ID error preserves all entered values", async () => {
  createManufacturerBatch.mockRejectedValue({ response: { status: 409, data: { error: "Batch ID already exists" } } });
  show(); fill(); submit();
  await screen.findByText("Batch ID already exists");
  expect(screen.getByLabelText("Batch ID *")).toHaveValue(" CLASS-1 ");
  expect(screen.getByLabelText("Batch quantity (doses) *")).toHaveValue(100);
  expect(screen.getByRole("button", { name: "Create batch and report" })).not.toBeDisabled();
});

test.each([401, 403])("auth failure %s directs the user to manufacturer login", async status => {
  createManufacturerBatch.mockRejectedValue({ response: { status, data: { error: "Denied" } } });
  show(); fill(); submit();
  await screen.findByText(/Sign in again as Manufacturer/);
});

test("partial creation failure blocks blind resubmission", async () => {
  createManufacturerBatch.mockRejectedValue({ response: { status: 500, data: { code: "MANUFACTURING_INCOMPLETE", error: "Creation stopped" } } });
  show(); fill(); submit();
  await screen.findByText(/creation may have partially completed/);
  expect(screen.getByRole("button", { name: "Create batch and report" })).toBeDisabled();
  submit(); expect(createManufacturerBatch).toHaveBeenCalledTimes(1);
});

test("known preflight failure can be retried after fixing the chain", async () => {
  createManufacturerBatch.mockRejectedValueOnce({ response: { status: 503, data: { code: "BLOCKCHAIN_NOT_READY", error: "Start the local blockchain" } } });
  show(); fill(); submit();
  await screen.findByText("Start the local blockchain");
  expect(screen.getByRole("button", { name: "Create batch and report" })).not.toBeDisabled();
  submit(); await screen.findByText("Batch CLASS-1 created successfully.");
});

test("a refresh error never turns a successful creation into a retryable failure", async () => {
  const onCreated = jest.fn().mockRejectedValueOnce(new Error("Dashboard unavailable")).mockResolvedValue(undefined);
  show(onCreated); fill(); submit();
  await screen.findByText(/batch was created, but the dashboard could not refresh/);
  expect(screen.queryByRole("button", { name: "Create batch and report" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
  expect(createManufacturerBatch).toHaveBeenCalledTimes(1);
});

test("cancel closes without writing any data", () => {
  const { onClose } = show(); fill();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled(); expect(createManufacturerBatch).not.toHaveBeenCalled();
});
