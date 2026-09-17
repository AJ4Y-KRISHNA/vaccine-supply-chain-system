import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SupplyPlannerPanel from "../components/Admin/SupplyPlannerPanel";
import API from "../services/api";
jest.mock("../services/api", () => ({ get: jest.fn(), post: jest.fn() }));
test("requires explicit constraints and presents a non-executing plan", async () => {
  API.get.mockResolvedValue({ data: { orders: [{ orderId: "O1", hospital: "Demo Hospital", requestedDoses: 10, vaccineType: "TEST" }] } });
  API.post.mockResolvedValue({ data: { planId: "P1", totalAllocated: 10, execution: "No stock reserved", allocations: [], unfilled: [], excludedBatches: [] } });
  render(<SupplyPlannerPanel />);
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.change(screen.getByLabelText(/Transport capacity/), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText(/Hospital free capacity/), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText(/Transit hours/), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /Generate advisory/ }));
  await waitFor(() => expect(API.post).toHaveBeenCalledWith("/admin/supply-plan", expect.objectContaining({ transportCapacityDoses: 20, destinations: [{ orderId: "O1", freeCapacityDoses: 10, transitHours: 2 }] })));
  expect(await screen.findByText(/No stock reserved/)).toBeInTheDocument();
});
