import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShipmentAccessPanel from "./ShipmentAccessPanel.jsx";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  useFieldOperatorStore.setState({
    accessToken: "",
    identity: null,
    role: "",
    shipments: [],
    shipmentLoadStatus: "idle",
    shipmentLoadError: "",
    selectedShipmentId: "",
    connectionStatus: "idle",
  });
  vi.unstubAllGlobals();
});

describe("ShipmentAccessPanel", () => {
  it("signs in, stores the JWT only for this tab, and selects an in-transit shipment into the URL", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          token: "demo.jwt.token",
          role: "manufacturer",
          identity: { email: "maker@example.test" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          shipments: [
            {
              shipmentId: "SHIP-101",
              batchId: "BATCH-1",
              status: "In Transit",
              destination: "Clinic A",
            },
            {
              shipmentId: "SHIP-102",
              batchId: "BATCH-2",
              status: "Delivered",
              destination: "Clinic B",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ShipmentAccessPanel />);
    await user.type(screen.getByLabelText("Account email"), "maker@example.test");
    await user.type(screen.getByLabelText("Password"), "demo-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const picker = await screen.findByLabelText("In-transit shipment");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /SHIP-101/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("option", { name: /SHIP-102/ })).not.toBeInTheDocument();
    await user.selectOptions(picker, "SHIP-101");

    expect(window.location.search).toBe("?shipmentId=SHIP-101");
    expect(useFieldOperatorStore.getState().selectedShipmentId).toBe("SHIP-101");
    expect(sessionStorage.getItem("fieldOperator.accessToken")).toBe("demo.jwt.token");
    expect(localStorage.getItem("fieldOperator.accessToken")).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/live-shipments?limit=100",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("shows an inline sign-in error and does not retain a password when credentials are rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Login failed" }, 401)),
    );
    render(<ShipmentAccessPanel />);
    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: "bad@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Login failed");
    expect(sessionStorage.getItem("fieldOperator.accessToken")).toBeNull();
  });
});
