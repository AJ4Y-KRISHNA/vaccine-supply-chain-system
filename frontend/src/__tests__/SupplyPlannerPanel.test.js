import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SupplyPlannerPanel from "../components/Admin/SupplyPlannerPanel";
import API from "../services/api";
jest.mock("../services/api", () => ({ get: jest.fn(), post: jest.fn() }));
beforeEach(() => { jest.resetAllMocks(); });
test("requires explicit constraints and presents a non-executing plan", async () => {
  API.get.mockResolvedValue({ data: { orders: [{ orderId: "O1", hospital: "Demo Hospital", requestedDoses: 10, vaccineType: "TEST" }] } });
  API.post.mockResolvedValue({ data: { planId: "P1", totalAllocated: 10, execution: "No stock reserved", allocations: [], unfilled: [], excludedBatches: [] } });
  render(<SupplyPlannerPanel />);
  expect(screen.getByText(/constrained supply planning/i)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.change(screen.getByLabelText(/Transport capacity/), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText(/Hospital free capacity/), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText(/Transit hours/), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /Generate allocation plan/ }));
  await waitFor(() => expect(API.post).toHaveBeenCalledWith("/admin/supply-plan", expect.objectContaining({ transportCapacityDoses: 20, destinations: [{ orderId: "O1", freeCapacityDoses: 10, transitHours: 2 }] })));
  expect(await screen.findByText(/No stock reserved/)).toBeInTheDocument();
});

test("rejects empty selections and blank numeric constraints instead of treating them as zero", async () => {
  API.get.mockResolvedValue({ data: { orders: [{ orderId: "O1", hospital: "Demo", requestedDoses: 10 }] } });
  render(<SupplyPlannerPanel />);
  await screen.findByRole("checkbox");
  fireEvent.click(screen.getByRole("button", { name: /Generate allocation plan/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select between 1 and 100");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Generate allocation plan/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("Transport capacity");
  fireEvent.change(screen.getByLabelText(/Transport capacity/), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: /Generate allocation plan/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("For O1");
  expect(API.post).not.toHaveBeenCalled();
});

test("shows empty and failure states and recovers with a refresh", async () => {
  API.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: { orders: [] } });
  render(<SupplyPlannerPanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Planning inputs unavailable");
  expect(screen.getByRole("button", { name: /Generate allocation plan/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Refresh pending/ }));
  expect(await screen.findByText(/No pending hospital orders/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("rejects inconsistent shared hospital capacity across selected orders", async () => {
  API.get.mockResolvedValue({ data: { orders: [{ orderId: "O1", hospital: "Demo", requestedDoses: 10 }, { orderId: "O2", hospital: "demo", requestedDoses: 10 }] } });
  render(<SupplyPlannerPanel />);
  for (const checkbox of await screen.findAllByRole("checkbox")) fireEvent.click(checkbox);
  fireEvent.change(screen.getByLabelText(/Transport capacity/), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText(/Hospital free capacity — O1/), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText(/Hospital free capacity — O2/), { target: { value: "30" } });
  for (const input of screen.getAllByLabelText(/Transit hours/)) fireEvent.change(input, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /Generate allocation plan/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("same shared free capacity");
  expect(API.post).not.toHaveBeenCalled();
});
