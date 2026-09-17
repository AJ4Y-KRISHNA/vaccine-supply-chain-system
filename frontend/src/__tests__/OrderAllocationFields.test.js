import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import OrderAllocationFields from "../components/Admin/OrderAllocationFields";
const order = { orderId: "O1", vaccineType: "Synthetic", requestedDoses: 60, status: "Pending" };
const options = [
  { batchId: "B1", vaccineType: "Synthetic", remainingDoses: 100, eligible: true, reasons: [] },
  { batchId: "HELD", vaccineType: "Synthetic", remainingDoses: 100, eligible: false, reasons: ["COLD_CHAIN_HOLD"] },
  { batchId: "SHORT", vaccineType: "Synthetic", remainingDoses: 20, eligible: true, reasons: [] },
  { batchId: "OTHER", vaccineType: "Other", remainingDoses: 100, eligible: true, reasons: [] },
];

test("selection requires explicit real batch and distributor choices", () => {
  const changed = jest.fn();
  render(<OrderAllocationFields order={order} options={options} distributors={["dist-a"]} onChange={changed} />);
  expect(screen.getByLabelText("Batch for O1")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Batch for O1"), { target: { value: "B1" } });
  expect(changed).toHaveBeenCalledWith({ batchId: "B1" });
  fireEvent.change(screen.getByLabelText("Distributor for O1"), { target: { value: "dist-a" } });
  expect(changed).toHaveBeenCalledWith({ distributor: "dist-a" });
  expect(screen.getByRole("option", { name: /HELD/ })).toBeDisabled();
  expect(screen.getByRole("option", { name: /SHORT/ })).toBeDisabled();
  expect(screen.queryByRole("option", { name: /OTHER/ })).not.toBeInTheDocument();
});

test("explains blocked stock instead of inventing an allocation", () => {
  render(<OrderAllocationFields order={order} options={options.slice(1)} distributors={[]} onChange={jest.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("No eligible batch");
});

test("reviewed orders cannot be reassigned through the form", () => {
  render(<OrderAllocationFields order={{ ...order, status: "Approved", allocatedBatchId: "B1", shipmentId: "S1" }} options={options} distributors={["dist-a"]} onChange={jest.fn()} />);
  expect(screen.getByLabelText("Batch for O1")).toBeDisabled();
  expect(screen.getByText("Allocated: B1 / S1")).toBeInTheDocument();
});
