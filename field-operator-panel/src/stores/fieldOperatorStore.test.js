import { afterEach, describe, expect, it } from "vitest";
import { useFieldOperatorStore } from "./fieldOperatorStore.js";

afterEach(() => {
  useFieldOperatorStore.setState({ alerts: [], readingHistory: [] });
});

describe("uncapped persisted and live telemetry history", () => {
  it("keeps every history point and merges live updates without duplicates", () => {
    const readings = Array.from({ length: 45 }, (_, index) => ({
      readingId: `reading-${index}`,
      sequenceNumber: index,
      simulationClock: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      temperature: 4 + index / 100,
      deviceId: "SENSOR-1",
    }));
    useFieldOperatorStore.getState().setInitMessage({ currentState: {} }, readings.at(-1), readings, []);
    useFieldOperatorStore.getState().setReading({ ...readings[44], temperature: 4.99 });
    useFieldOperatorStore.getState().setReading({ readingId: "reading-45", sequenceNumber: 45,
      simulationClock: new Date(Date.UTC(2026, 0, 1, 0, 45)).toISOString(), deviceId: "SENSOR-1", temperature: 5 });

    const history = useFieldOperatorStore.getState().readingHistory;
    expect(history).toHaveLength(46);
    expect(history[44].temperature).toBe(4.99);
    expect(history.at(-1).readingId).toBe("reading-45");
  });
});

describe("field operator alert state", () => {
  it("de-duplicates alert ids and records local acknowledgement without resolving an event", () => {
    const alert = { alertId: "ALERT-1", severity: "critical", message: "Excursion" };
    useFieldOperatorStore.getState().addAlert(alert);
    useFieldOperatorStore.getState().addAlert(alert);

    expect(useFieldOperatorStore.getState().alerts).toHaveLength(1);
    expect(useFieldOperatorStore.getState().alerts[0]).toMatchObject({
      read: false,
      acknowledged: false,
    });

    useFieldOperatorStore.getState().acknowledgeAlert("ALERT-1");
    expect(useFieldOperatorStore.getState().alerts[0]).toMatchObject({
      read: true,
      acknowledged: true,
    });
    expect(useFieldOperatorStore.getState().alerts[0]).not.toHaveProperty("resolved");
  });

  it("updates an existing alert as its saved event changes and preserves local acknowledgement", () => {
    useFieldOperatorStore.getState().addAlert({ alertId: "ALERT-2", severity: "warning", status: "ACTIVE" });
    useFieldOperatorStore.getState().acknowledgeAlert("ALERT-2");
    useFieldOperatorStore.getState().addAlert({ alertId: "ALERT-2", severity: "critical", status: "RESOLVED" });

    expect(useFieldOperatorStore.getState().alerts).toEqual([
      expect.objectContaining({ alertId: "ALERT-2", severity: "critical", status: "RESOLVED",
        read: true, acknowledged: true }),
    ]);
  });
});
