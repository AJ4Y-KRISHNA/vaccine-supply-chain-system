import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Login from "../pages/Login";
import ProtectedRoute from "../components/ProtectedRoute";
import API from "../services/api";
jest.mock("../services/api", () => ({ post: jest.fn() }));
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: jest.fn() }) }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks(); });
test("failed login never creates a role-only session", async () => {
  API.post.mockRejectedValue(new Error("Unauthorized"));
  render(<MemoryRouter><Login /></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "test@example.test" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "incorrect" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Admin" } });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));
  await waitFor(() => expect(API.post).toHaveBeenCalled());
  await waitFor(() => expect(sessionStorage.getItem("role")).toBeNull());
  expect(sessionStorage.getItem("token")).toBeNull();
});
test("role storage alone cannot open a protected page", () => {
  sessionStorage.setItem("role", "Admin");
  render(<MemoryRouter><ProtectedRoute allowed={["Admin"]}><div>Protected content</div></ProtectedRoute></MemoryRouter>);
  expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
});
