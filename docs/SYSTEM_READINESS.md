# Local-system readiness checks

## Purpose and limits

The Admin dashboard's **Local-system readiness** panel distinguishes whether a dependency can be contacted (**reachable**) from whether its functional probe succeeds (**healthy**). A service may be reachable but unhealthy—for example, MongoDB may accept connections while a read/write operation fails. Results include a status, pass/fail flag and measured latency for each check. This is a local software readiness aid, not a production-availability SLA or clinical safety assessment.

## Checks performed

| Service | Reachability signal | Functional health check | Side effects / limits |
| --- | --- | --- | --- |
| Backend API | The authenticated readiness endpoint returned a response. | The endpoint successfully assembled its readiness response. | Its server-side duration includes the dependency probes below; it is not an independent API performance benchmark and does not measure every route. |
| MongoDB | Mongoose reports an active connection. | Write a random synthetic probe record, read it back, verify its token, then delete it. | Uses `system_readiness_probes`; a failed cleanup is reported as unhealthy. It does not write supply-chain records. |
| Local blockchain | Local JSON-RPC responds and reports chain ID 31337. | Read the block number, request one empty local `evm_mine` block, then confirm that the number advanced. The configured contract address is checked for deployed bytecode when present. | The check is limited to loopback HTTP RPC. It advances the local chain height by one empty block but sends no contract transaction and changes no contract state. Contract/ABI availability is shown separately from block-production health. |
| FastAPI AI service | A local HTTP response is received. | Send a bounded synthetic `/decision/decide` request and verify the advisory response shape and numeric forecast/recommendation fields. | Only loopback HTTP AI URLs are called; non-local URLs are blocked. The synthetic input uses six fixed values, and the request times out after 2.5 seconds. No user, patient or live-feed data is sent. |

All dependency checks are independent and are returned separately by `GET /api/admin/readiness`. Failure reasons are non-sensitive status codes; RPC URLs, contract addresses, environment values, credentials and private keys are not returned. The endpoint remains administrator-only.

## Interpreting results

- **Reachable: Yes, Functional check: Passed** — the dependency responded and the probe completed successfully within its limit.
- **Reachable: Yes, Functional check: Failed** — contact succeeded, but the operation or expected response did not.
- **Reachable: No** — no usable response was obtained, the service is disconnected, or a non-local endpoint was blocked.
- **Latency** — elapsed milliseconds for that specific probe; it is not a general performance benchmark.

The blockchain probe intentionally mines an empty block because the local Hardhat node mines on demand and does not advance while idle. A healthy result therefore proves that this local node can service RPC and mine a block; it does not prove public-network connectivity, contract correctness, or production readiness.
