const { isDoseCount } = require("./inventoryEligibility");

const PRIORITY_RANK = { Critical: 0, High: 1, Normal: 2, Low: 3 };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

function addEdge(graph, from, to, capacity, cost, metadata = null) {
  const forward = { to, reverseIndex: graph[to].length, capacity, initialCapacity: capacity, cost, metadata };
  const reverse = { to: from, reverseIndex: graph[from].length, capacity: 0, initialCapacity: 0, cost: -cost, metadata: null };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

function minCostMaxFlow(graph, source, sink, limit) {
  let flow = 0;
  const nodeCount = graph.length;
  while (flow < limit) {
    const distance = Array(nodeCount).fill(null);
    const previousNode = Array(nodeCount).fill(-1);
    const previousEdge = Array(nodeCount).fill(-1);
    const queued = Array(nodeCount).fill(false);
    const queue = [source];
    let queueIndex = 0;
    distance[source] = 0n;
    queued[source] = true;

    // SPFA handles negative reverse-edge costs so earlier allocations can be
    // rerouted when that produces a better whole-plan solution.
    while (queueIndex < queue.length) {
      const from = queue[queueIndex++];
      queued[from] = false;
      for (let edgeIndex = 0; edgeIndex < graph[from].length; edgeIndex += 1) {
        const edge = graph[from][edgeIndex];
        if (edge.capacity <= 0) continue;
        const nextDistance = distance[from] + edge.cost;
        if (distance[edge.to] !== null && distance[edge.to] <= nextDistance) continue;
        distance[edge.to] = nextDistance;
        previousNode[edge.to] = from;
        previousEdge[edge.to] = edgeIndex;
        if (!queued[edge.to]) { queue.push(edge.to); queued[edge.to] = true; }
      }
    }
    if (distance[sink] === null) break;

    let amount = limit - flow;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      amount = Math.min(amount, edge.capacity);
    }
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= amount;
      graph[node][edge.reverseIndex].capacity += amount;
    }
    flow += amount;
  }
  return flow;
}

function planSupply({ inventory, orders, destinations, transportCapacityDoses, asOf }) {
  const now = +new Date(asOf);
  if (!Number.isFinite(now)) fail("An explicit valid planning timestamp is required");
  if (!isDoseCount(transportCapacityDoses)) fail("Transport capacity must be a nonnegative whole number of doses");
  if (!Array.isArray(destinations) || !destinations.length || destinations.length > 100) fail("Select 1–100 pending orders with explicit capacity and transit inputs");

  const ids = new Set();
  const hospitalCapacities = new Map();
  const demands = destinations.map(input => {
    if (ids.has(input.orderId)) fail("Duplicate order selection");
    ids.add(input.orderId);
    const order = orders.find(candidate => candidate.orderId === input.orderId);
    if (!order || order.status !== "Pending" || !isDoseCount(order.requestedDoses) || !order.requestedDoses) fail("Every selected order must be pending with positive whole doses");
    if (!isDoseCount(input.freeCapacityDoses) || !Number.isFinite(input.transitHours) || input.transitHours < 0 || input.transitHours > 8760) fail("Provide free destination capacity and transit hours (0–8760)");
    const hospital = String(order.hospital).trim().toLowerCase();
    if (!hospital) fail("Every selected order must have a destination hospital");
    if (hospitalCapacities.has(hospital) && hospitalCapacities.get(hospital) !== input.freeCapacityDoses) fail("Use the same shared free capacity for orders going to one hospital");
    hospitalCapacities.set(hospital, input.freeCapacityDoses);
    return { ...input, order, hospital, arrivalAt: now + input.transitHours * 3600000,
      transitMinutes: Math.round(input.transitHours * 60), allocated: 0 };
  }).sort((a, b) => (PRIORITY_RANK[a.order.priority] ?? PRIORITY_RANK.Normal) - (PRIORITY_RANK[b.order.priority] ?? PRIORITY_RANK.Normal) || a.order.orderId.localeCompare(b.order.orderId));

  const excludedBatches = [];
  const candidates = [];
  for (const batch of inventory) {
    const reasons = [...(batch.reasons || [])];
    const expiry = batch.expiresAt ? +new Date(batch.expiresAt) : NaN;
    if (!Number.isFinite(expiry)) reasons.push("EXPIRY_NOT_CONFIGURED");
    else if (expiry <= now) reasons.push("EXPIRED");
    if (!isDoseCount(batch.remainingDoses)) reasons.push("INVALID_STOCK_RECORDS");
    if (reasons.length) excludedBatches.push({ batchId: batch.batchId, reasons: [...new Set(reasons)] });
    else if (batch.remainingDoses > 0) candidates.push({ ...batch, expiry, available: batch.remainingDoses });
  }
  candidates.sort((a, b) => a.expiry - b.expiry || a.batchId.localeCompare(b.batchId));

  const hospitals = [...hospitalCapacities.keys()].sort();
  const source = 0;
  const batchOffset = 1;
  const orderOffset = batchOffset + candidates.length;
  const hospitalOffset = orderOffset + demands.length;
  const transportNode = hospitalOffset + hospitals.length;
  const sink = transportNode + 1;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const hospitalNode = new Map(hospitals.map((name, index) => [name, hospitalOffset + index]));
  const maxTransitMinutes = BigInt(Math.max(0, ...demands.map(demand => demand.transitMinutes)));
  const batchCount = BigInt(candidates.length);
  const maxSecondaryPerDose = batchCount * (maxTransitMinutes + 1n) + maxTransitMinutes;
  const totalDemand = demands.reduce((sum, demand) => sum + BigInt(demand.order.requestedDoses), 0n);
  // One priority-rank step costs more than every possible route/shelf-life
  // cost in the complete plan. BigInt keeps that lexicographic weight exact.
  const priorityWeight = totalDemand * maxSecondaryPerDose + 1n;
  const assignmentEdges = [];

  candidates.forEach((batch, batchIndex) => {
    addEdge(graph, source, batchOffset + batchIndex, batch.available, 0n);
    demands.forEach((demand, orderIndex) => {
      if (batch.vaccineType !== demand.order.vaccineType || batch.expiry <= demand.arrivalAt) return;
      const secondaryCost = BigInt(batchIndex) * (maxTransitMinutes + 1n) + BigInt(demand.transitMinutes);
      const edge = addEdge(graph, batchOffset + batchIndex, orderOffset + orderIndex,
        Math.min(batch.available, demand.order.requestedDoses), secondaryCost,
        { batchIndex, orderIndex });
      assignmentEdges.push({ edge, batchIndex, orderIndex });
    });
  });

  demands.forEach((demand, orderIndex) => {
    const rank = BigInt(PRIORITY_RANK[demand.order.priority] ?? PRIORITY_RANK.Normal);
    addEdge(graph, orderOffset + orderIndex, hospitalNode.get(demand.hospital), demand.order.requestedDoses, rank * priorityWeight);
  });
  hospitals.forEach(hospital => addEdge(graph, hospitalNode.get(hospital), transportNode, hospitalCapacities.get(hospital), 0n));
  addEdge(graph, transportNode, sink, transportCapacityDoses, 0n);

  const totalAllocated = minCostMaxFlow(graph, source, sink, transportCapacityDoses);
  const allocations = [];
  for (const { edge, batchIndex, orderIndex } of assignmentEdges) {
    const quantity = edge.initialCapacity - edge.capacity;
    if (!quantity) continue;
    const batch = candidates[batchIndex];
    const demand = demands[orderIndex];
    demand.allocated += quantity;
    allocations.push({ orderId: demand.order.orderId, hospital: demand.order.hospital, batchId: batch.batchId,
      vaccineType: batch.vaccineType, quantity, arrivalAt: new Date(demand.arrivalAt).toISOString(),
      expiresAt: new Date(batch.expiry).toISOString(), transitHours: demand.transitHours,
      explanation: "Globally optimized whole-dose assignment; respects released/unheld stock, matching product, expiry after arrival, order demand, shared hospital capacity and total transport capacity." });
  }
  allocations.sort((a, b) => demands.findIndex(item => item.order.orderId === a.orderId) - demands.findIndex(item => item.order.orderId === b.orderId) ||
    +new Date(a.expiresAt) - +new Date(b.expiresAt) || a.batchId.localeCompare(b.batchId));
  const unfilled = demands.filter(demand => demand.allocated < demand.order.requestedDoses).map(demand => ({
    orderId: demand.order.orderId,
    doses: demand.order.requestedDoses - demand.allocated,
    reason: "Insufficient eligible stock arriving before expiry, destination capacity or transport capacity",
  }));

  return {
    algorithm: "constrained-min-cost-max-flow-v1",
    optimizationStatus: "OPTIMAL_MAX_FLOW",
    asOf: new Date(now).toISOString(),
    allocations,
    unfilled,
    excludedBatches,
    totalAllocated,
    optimizationObjective: "Maximize allocated doses, then prefer higher-priority orders, earliest-expiry eligible stock and shorter transit, in that order.",
    explanation: "A global minimum-cost maximum-flow solution was computed over batch stock, product compatibility, expiry-at-arrival, pending order demand, shared hospital capacity and total transport capacity. Approved order quantities are the demand signal; historical forecasts are not treated as measured demand.",
    execution: "The optimized plan is ready for review. No stock is reserved and no shipment is dispatched until an authorized user approves the corresponding order workflow.",
  };
}

module.exports = { planSupply, minCostMaxFlow };
