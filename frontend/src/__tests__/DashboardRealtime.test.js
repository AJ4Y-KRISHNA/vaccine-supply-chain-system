import React from "react";
import { act, render, screen } from "@testing-library/react";
import useDashboardRealtime from "../hooks/useDashboardRealtime";

class MockSocket {
  static CONNECTING = 0; static OPEN = 1;
  constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; MockSocket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  sendMessage(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
MockSocket.instances = [];
function Probe() { const { status, event } = useDashboardRealtime(); return <div>{status}:{event?.type || "none"}</div>; }

beforeEach(() => { MockSocket.instances = []; sessionStorage.setItem("token", "synthetic-test-token"); global.WebSocket = MockSocket; });
afterEach(() => { delete global.WebSocket; });

test("dashboard realtime hook becomes live after READY and degraded when the socket closes", () => {
  render(<><Probe /><Probe /></>);
  expect(MockSocket.instances).toHaveLength(1);
  expect(MockSocket.instances[0].url).toContain("/ws/dashboard");
  expect(MockSocket.instances[0].protocols[0]).toBe("vaccine-dashboard.v1");
  act(() => MockSocket.instances[0].sendMessage({ type: "READY" }));
  expect(screen.getAllByText("live:none")).toHaveLength(2);
  act(() => MockSocket.instances[0].sendMessage({ type: "READING", data: { temperature: 5 } }));
  expect(screen.getAllByText("live:READING")).toHaveLength(2);
  act(() => MockSocket.instances[0].close());
  expect(screen.getAllByText("degraded:READING")).toHaveLength(2);
});
