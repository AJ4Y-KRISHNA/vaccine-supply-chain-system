import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Login from "../pages/Login";
import ProtectedRoute from "../components/ProtectedRoute";
import { LogoutButton } from "../components/SessionControls";
import { clearSession, notifySessionChanged } from "../services/session";
import API from "../services/api";
jest.mock("../services/api", () => ({ post: jest.fn() }));
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: jest.fn() }) }));
const token = expires => `e30.${btoa(JSON.stringify({ exp: expires }))}.test-signature`;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks(); });
const fill = () => {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: " maker@example.test " } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-only" } });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Manufacturer" } });
};
test("login password visibility and reset controls work", () => {
  render(<MemoryRouter><Login /></MemoryRouter>); fill();
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByLabelText("Username")).toHaveValue("");
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Role")).toHaveValue("");
});
test("login submits once and navigates with the server-issued role", async () => {
  let resolve;
  API.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<MemoryRouter><Routes><Route path="/" element={<Login />} /><Route path="/manufacturer" element={<p>Maker workspace</p>} /></Routes></MemoryRouter>);
  fill();
  const button = screen.getByRole("button", { name: "Login" });
  fireEvent.click(button); fireEvent.click(button);
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith("/auth/login", { email: "maker@example.test", password: "synthetic-only", role: "manufacturer" });
  expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  await act(async () => resolve({ data: { token: token(Date.now() / 1000 + 60), role: "manufacturer" } }));
  expect(await screen.findByText("Maker workspace")).toBeInTheDocument();
});
test("logout removes the full local session and redirects", async () => {
  for (const key of ["token", "refreshToken", "role", "userEmail"]) sessionStorage.setItem(key, "test");
  render(<MemoryRouter initialEntries={["/protected"]}><Routes><Route path="/protected" element={<LogoutButton />} /><Route path="/" element={<p>Sign in</p>} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Logout" }));
  expect(await screen.findByText("Sign in")).toBeInTheDocument();
  for (const key of ["token", "refreshToken", "role", "userEmail"]) expect(sessionStorage.getItem(key)).toBeNull();
});
test("expired sessions cannot render a role dashboard", () => {
  sessionStorage.setItem("token", token(1)); sessionStorage.setItem("role", "Manufacturer");
  render(<MemoryRouter><ProtectedRoute allowed={["Manufacturer"]}><p>Protected data</p></ProtectedRoute></MemoryRouter>);
  expect(screen.queryByText("Protected data")).not.toBeInTheDocument();
});
test("session clearing immediately removes protected content", async () => {
  sessionStorage.setItem("token", token(Date.now() / 1000 + 60)); sessionStorage.setItem("role", "Manufacturer");
  render(<MemoryRouter initialEntries={["/manufacturer"]}><Routes><Route path="/manufacturer" element={<ProtectedRoute allowed={["Manufacturer"]}><p>Protected data</p></ProtectedRoute>} /><Route path="/" element={<p>Sign in</p>} /></Routes></MemoryRouter>);
  expect(screen.getByText("Protected data")).toBeInTheDocument();
  act(() => clearSession());
  await waitFor(() => expect(screen.queryByText("Protected data")).not.toBeInTheDocument());
});
test("switching between same-role accounts remounts protected account data", () => {
  const oldToken = token(Date.now() / 1000 + 60);
  sessionStorage.setItem("token", oldToken); sessionStorage.setItem("role", "Manufacturer"); sessionStorage.setItem("userEmail", "old@example.test");
  function AccountView() { const [account] = React.useState(() => sessionStorage.getItem("userEmail")); return <p>{account}</p>; }
  render(<MemoryRouter><ProtectedRoute allowed={["Manufacturer"]}><AccountView /></ProtectedRoute></MemoryRouter>);
  expect(screen.getByText("old@example.test")).toBeInTheDocument();
  act(() => { sessionStorage.setItem("token", token(Date.now() / 1000 + 120)); sessionStorage.setItem("userEmail", "new@example.test"); notifySessionChanged(); });
  expect(screen.queryByText("old@example.test")).not.toBeInTheDocument();
  expect(screen.getByText("new@example.test")).toBeInTheDocument();
});

test("signing out clears only this tab session and preserves other local demo data", () => {
  sessionStorage.setItem("token", token(Date.now() / 1000 + 60));
  localStorage.setItem("vaccine.guidedDemoRun.v1", "demo-run");
  clearSession();
  expect(sessionStorage.getItem("token")).toBeNull();
  expect(localStorage.getItem("vaccine.guidedDemoRun.v1")).toBe("demo-run");
});
