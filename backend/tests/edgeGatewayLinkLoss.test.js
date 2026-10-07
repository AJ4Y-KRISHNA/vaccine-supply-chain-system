const { EdgeGatewayPipeline } = require("../edge-gateway/pipeline");

test("suppressed stationary fixes still advance physical GPS context before a motion burst", async () => {
  const store = createMemoryStore(), forwarded = [];
  let time = 0;
  const pipeline = new EdgeGatewayPipeline({ store, heartbeatMs: 1000000, now: () => time,
    forward: async rows => { forwarded.push(...rows); return rows; } });
  const reading = (seq, seconds, latitude) => ({ deviceId: "GPS-STATIONARY-SYNTHETIC", temperature: 5,
    sequenceNumber: seq, recordedAt: new Date(100000 + seconds * 1000), location: { lat: latitude, lng: 76 } });
  await pipeline.receive(reading(0, 0, 10));
  time = 100000;
  expect((await pipeline.receive(reading(1, 100, 10))).suppressed).toBe(true);
  time = 110000;
  await pipeline.receive(reading(2, 110, 10.01));
  expect(forwarded).toHaveLength(2);
  expect(forwarded[1].edge.gpsPlausibility.flagged).toBe(true);
  expect(forwarded[1].edge.gpsPlausibility.impliedSpeedKmh).toBeGreaterThan(390);
});

function createMemoryStore() {
  const states = new Map();
  const queue = [];
  return {
    states, queue,
    getState: async id => states.get(id) || null,
    saveState: async (id, state) => states.set(id, state),
    findBySourceSequence: async (id, source) => queue.find(row => row.deviceId === id && row.sourceSequenceNumber === source) || null,
    enqueue: async row => { const entry = { ...row, id: String(queue.length + 1), status: "pending" }; queue.push(entry); return entry; },
    getQueueEntry: async id => queue.find(row => row.id === id),
    listPending: async id => queue.filter(row => row.deviceId === id && row.status === "pending").sort((a,b) => a.sequenceNumber - b.sequenceNumber),
    pendingDevices: async () => [...new Set(queue.filter(row => row.status === "pending").map(row => row.deviceId))],
    markForwarded: async id => { const row = queue.find(item => item.id === id); row.status = "forwarded"; },
  };
}

test("LINK_LOSS buffers edge-tagged readings and reconnect flushes every sequence once, in order", async () => {
  const store = createMemoryStore();
  const persisted = [];
  const pipeline = new EdgeGatewayPipeline({ store, heartbeatMs: 30000,
    now: (() => { let time = 1000; return () => time += 1000; })(),
    forward: async rows => { persisted.push(...rows); return rows.map(row => ({ _id: `log-${row.sequenceNumber}` })); } });
  const sample = (sequenceNumber, scenario) => ({ deviceId: "DEVICE-1", batchId: "BATCH-1", vehicleId: "TRUCK-1",
    temperature: 5 + sequenceNumber / 10, humidity: 50, batteryLevel: 99, latitude: 9.93, longitude: 76.26,
    timestamp: new Date(200000 + sequenceNumber * 1000).toISOString(), sequenceNumber,
    simulation: { scenario, tick: sequenceNumber } });

  for (let sequence = 0; sequence < 5; sequence += 1) {
    const buffered = await pipeline.receive(sample(sequence, "LINK_LOSS"));
    expect(buffered.delivery).toBe("buffered");
    expect(buffered.edge).toBeDefined();
    expect(buffered.edge.localAlert).toHaveProperty("active");
  }
  expect(persisted).toHaveLength(0);
  await pipeline.flushAll();
  const restarted = new EdgeGatewayPipeline({ store, forward: pipeline.forward });
  await restarted.flushAll();
  expect(persisted).toHaveLength(0); // periodic/restarted flush must respect link loss
  expect(store.queue.map(row => row.sequenceNumber)).toEqual([0, 1, 2, 3, 4]);

  await pipeline.receive(sample(5, "NORMAL"));
  expect(persisted.map(row => row.sequenceNumber)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(persisted.every(row => row.edge?.localAlert)).toBe(true);
  await pipeline.receive(sample(5, "NORMAL"));
  expect(persisted).toHaveLength(6);
});
