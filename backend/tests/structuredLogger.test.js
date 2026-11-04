const logger = require("../services/structuredLogger");
const { runWithCorrelationId } = require("../services/correlationContext");

test("writes a JSON event with request correlation metadata outside test mode", () => {
  const oldEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  try {
    runWithCorrelationId("trace.logger-1", () => logger.info("telemetry.saved", { batchId: "SYNTHETIC-BATCH" }));
    const entry = JSON.parse(output.mock.calls[0][0]);
    expect(entry).toMatchObject({ level: "info", event: "telemetry.saved", correlationId: "trace.logger-1",
      batchId: "SYNTHETIC-BATCH", service: "vaccine-supply-chain-backend" });
  } finally {
    output.mockRestore();
    if (oldEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnvironment;
  }
});
