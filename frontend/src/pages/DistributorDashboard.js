import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LiveShipmentVisualizer from "../components/LiveShipmentVisualizer";
import TemperatureAlertPanel from "../components/TemperatureAlertPanel";
import TraceabilityPanel from "../components/TraceabilityPanel";
import StatusBadge from "../components/StatusBadge";
import { LogoutButton } from "../components/SessionControls";
import {
  Truck, CheckSquare, Search, Bell, User,
  Shield, FileText, Activity as ChartActivity, LogOut, Download, AlertTriangle, Home, RefreshCw
} from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { fetchDistributorDashboard } from "../services/dashboard";
import { useToast } from "../components/Toast";
import BlockchainLog from "../components/BlockchainLog";
import { fetchDistributorOrders } from "../services/workflow";
import { verifyShipment, dispatchShipment, supplyShipment } from "../services/distributorOperations";
import { downloadOperationalCsv } from "../services/operationalExport";
import ManualReadingEntry from "../components/ManualReadingEntry";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const defaultDeliveryHistory = [0, 0, 0, 0, 0, 0, 0];
const defaultLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const deliveryHistoryOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: {
      beginAtZero: true,
      grid: { borderDash: [4, 4], display: true, color: "#edf3fa" },
      ticks: { color: "#7f91a7", font: { size: 11 } },
    },
    x: {
      grid: { display: false },
      ticks: { color: "#7f91a7", font: { size: 11 } },
    },
  },
};

function DistributorDashboard() {
  const [shipments, setShipments] = useState([]);
  const [tempLogs, setTempLogs] = useState([]);
  const [totals, setTotals] = useState({ totalShipments: 0, inTransit: 0, delivered: 0, pending: 0, tempAlerts: 0 });
  const [deliveryHistory, setDeliveryHistory] = useState(defaultDeliveryHistory);
  const [deliveryLabels, setDeliveryLabels] = useState(defaultLabels);
  const [orderNotifications, setOrderNotifications] = useState([]);
  const [approvedOrders, setApprovedOrders] = useState([]);
  const [confirmedDeliveries, setConfirmedDeliveries] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const actionLock = useRef(false);
  const { addToast } = useToast();
  const auditBatchIds = useMemo(
    () => [
      ...shipments.map((shipment) => shipment.id),
      ...approvedOrders.map((item) => item.allocatedBatchId),
      ...confirmedDeliveries.map((item) => item.batchId),
    ].filter(Boolean),
    [shipments, approvedOrders, confirmedDeliveries]
  );

  const load = useCallback(async () => {
      setLoading(true);
      setLoadError("");
      const [dashboardResult, ordersResult] = await Promise.allSettled([
        fetchDistributorDashboard(),
        fetchDistributorOrders(),
      ]);

      if (dashboardResult.status === "fulfilled") {
        const data = dashboardResult.value;
        const shipmentRows = (data.shipments || []).map((shipment) => ({
          shipmentId: shipment.shipmentId,
          id: shipment.batchId || shipment.shipmentId,
          workflowStatus: shipment.status || "Pending",
          held: Boolean(shipment.coldChainHoldAlertIds?.length || /quarantin/i.test(shipment.coldChainStatus || "")),
          confirmed: Boolean(shipment.hospitalConfirmed),
          type: shipment.vaccineType || "Mixed",
          qty: Number(shipment.quantity || 0).toLocaleString(),
          dest: shipment.destination || "N/A",
          status: shipment.coldChainStatus || shipment.status || "Pending",
          txHash: shipment.txHash || "pending",
        }));

        setShipments(shipmentRows);
        setTempLogs(
          (data.tempLogs || []).map((log) => ({
            id: log.id,
            range: log.range,
            status: log.status,
            bg: log.status === "Alert" ? "bg-[#eab308]" : "bg-[#10b981]",
            badge:
              log.status === "Alert"
                ? "bg-orange-50 text-orange-600 border border-orange-200"
                : "bg-teal-50 text-teal-600 border border-teal-200",
          }))
        );
        setTotals(data.totals || { totalShipments: 0, inTransit: 0, delivered: 0, pending: 0, tempAlerts: 0 });
        setDeliveryHistory(data.deliveryHistory?.values || defaultDeliveryHistory);
        setDeliveryLabels(data.deliveryHistory?.labels || defaultLabels);
        setConfirmedDeliveries(data.confirmedDeliveries || []);
      } else {
        setShipments([]);
        setTempLogs([]);
        setConfirmedDeliveries([]);
        setTotals({ totalShipments: 0, inTransit: 0, delivered: 0, pending: 0, tempAlerts: 0 });
        setDeliveryHistory(defaultDeliveryHistory);
        setDeliveryLabels(defaultLabels);
        addToast("error", "Distributor dashboard failed to load");
        setLoadError("Shipment data could not be loaded. Check the backend connection and your signed-in role, then refresh.");
      }

      if (ordersResult.status === "fulfilled") {
        setOrderNotifications(ordersResult.value.notifications || []);
        setApprovedOrders(ordersResult.value.orders || []);
      } else {
        setOrderNotifications([]);
        setApprovedOrders([]);
        addToast("error", "Approved hospital order feed could not be loaded");
        setLoadError("Some dashboard data could not be loaded. Refresh to retry.");
      }
      setLoading(false);
  }, [addToast]);
  useEffect(() => {
    load();
  }, [load]);

  const shownShipments = shipments.filter(ship => [ship.shipmentId, ship.id, ship.type, ship.dest, ship.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const navigateSection = id => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const performAction = async (shipment, action) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setPendingAction(shipment.shipmentId);
    setActionError("");
    try {
      const operation = { verify: verifyShipment, dispatch: dispatchShipment, supply: supplyShipment }[action];
      const result = await operation(shipment.shipmentId);
      if (action === "verify" && result.verification?.status !== "Verified") throw new Error("Batch verification is still pending. Review the manufacturer record before dispatch.");
      addToast("success", `${shipment.shipmentId}: ${action === "verify" ? "verified" : action === "dispatch" ? "dispatched" : "supplied; awaiting hospital receipt"}`);
      await load();
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Shipment action failed.";
      setActionError(`${message}${!error.response || error.response.status >= 500 ? " Refresh and inspect the shipment history before retrying; the request may have partially completed." : ""}`);
      addToast("error", message);
    } finally {
      actionLock.current = false;
      setPendingAction("");
    }
  };
  const exportReport = () => downloadOperationalCsv("distributor-shipments.csv", ["Shipment ID", "Batch ID", "Vaccine", "Quantity", "Destination", "Status", "Transaction hash"], shownShipments.map(ship => [ship.shipmentId, ship.id, ship.type, ship.qty, ship.dest, ship.status, ship.txHash]));

  const deliveryHistoryData = {
    labels: deliveryLabels,
    datasets: [
      {
        label: "Shipments",
        data: deliveryHistory,
        backgroundColor: "#10b981",
        borderRadius: 4,
        barThickness: 16,
      },
    ],
  };

  return (
    <div className="dashboard-page min-h-screen bg-[linear-gradient(180deg,#eef5fd_0%,#f8fbff_42%,#f4f8fd_100%)] font-sans text-gray-800">
      <div className="mx-auto max-w-[1500px] px-5"><ManualReadingEntry /></div>
      <header className="dashboard-header bg-gradient-to-r from-[#103968] via-[#154986] to-[#1f6bbb] text-white flex items-center justify-between px-6 py-3 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-white p-1.5 text-[#153e75] rounded-full shadow-inner">
            <Shield size={24} />
          </div>
          <h1 className="text-lg font-bold tracking-wide">Vaccine Supply Chain</h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              aria-label="Search shipments"
              placeholder="Search shipments..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="pl-9 pr-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-sm focus:outline-none focus:bg-white/20 transition-all text-white placeholder-white/60 w-64"
            />
          </div>
          <button type="button" aria-label="View cold-chain alerts" onClick={() => navigateSection("distributor-alerts")} className="relative">
            <Bell size={20} />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold">{totals.tempAlerts}</div>
          </button>
          <div className="flex items-center gap-2 text-sm font-medium border-l border-white/20 pl-4">
            <span className="hidden sm:inline">Distributor</span>
            <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center">
              <User size={18} />
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard-layout flex">
        <aside className="dashboard-sidebar w-60 bg-[linear-gradient(180deg,#193f74,#1c4f8b_62%,#1f5c9f)] min-h-[calc(100vh-64px)] text-white/90 shadow-2xl z-40 flex flex-col pt-6 flex-shrink-0">
          <div className="mx-3 mb-4 rounded-2xl bg-[#2870c4] px-4 py-4 text-white shadow-lg shadow-blue-900/20">
            <div className="text-xl font-bold leading-tight">Distributor Dashboard</div>
          </div>

          <nav className="flex flex-col gap-1 px-3 flex-1">
            <a href="#distributor-overview" className="flex items-center gap-3 bg-white text-[#1e4881] px-4 py-3 rounded-xl font-bold shadow-md">
              <Home size={18} />
              <span>Dashboard</span>
            </a>
            <a href="#distributor-shipments" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <Truck size={18} />
              <span>Shipments</span>
            </a>
            <a href="#distributor-tracking" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <LogOut size={18} className="rotate-180" />
              <span>Batch Tracking</span>
            </a>
            <a href="#distributor-temperature" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <ChartActivity size={18} />
              <span>Temperature Logs</span>
            </a>
            <a href="#distributor-history" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <FileText size={18} />
              <span>Delivery History</span>
            </a>
            <a href="#distributor-reports" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <Shield size={18} />
              <span>Reports</span>
            </a>
            <LogoutButton className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 font-medium mt-auto mb-4" />
          </nav>

          <div className="h-52 relative overflow-hidden flex items-end justify-center bg-gradient-to-t from-blue-950/55 to-transparent p-4">
            <div className="absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.1),transparent_24%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.12),transparent_25%)]"></div>
            <div className="w-16 h-32 bg-white/10 border-2 border-white/20 rounded-t-xl relative overflow-hidden backdrop-blur-md shadow-xl">
              <div className="absolute bottom-0 w-full bg-blue-400 h-2/3 opacity-80 mix-blend-overlay"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50 text-xs font-bold rotate-90 tracking-widest uppercase">COLD CHAIN</div>
            </div>
          </div>
        </aside>

        <main className="dashboard-main min-w-0 flex-1 overflow-x-hidden p-6 lg:p-8">
          <div className="dashboard-content mx-auto max-w-[1240px]">
          <div id="distributor-overview" className="flex flex-wrap gap-3 justify-between items-center mb-6 scroll-mt-24">
            <h2 className="text-[1.95rem] text-gray-800 font-bold">Distributor Dashboard</h2>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={load} disabled={loading || Boolean(pendingAction)} className="flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-50"><RefreshCw size={16} />{loading ? "Refreshing..." : "Refresh dashboard"}</button>
            <button type="button" onClick={exportReport} disabled={loading || !shownShipments.length} className="flex items-center gap-2 text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg font-medium text-sm transition-colors border border-blue-200 disabled:opacity-50">
              <Download size={16} /> Export Report
            </button></div>
          </div>
          {loadError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-700">{loadError}</p>}
          {actionError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-700">{actionError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-[14px] p-5 shadow-sm border border-[#e9eff7] flex items-center gap-4">
              <div className="bg-blue-600 p-3.5 rounded-2xl text-white shadow-lg shadow-blue-600/30">
                <Truck size={24} />
              </div>
              <div>
                <p className="text-blue-900/60 text-xs font-bold uppercase tracking-wider">Total Shipments</p>
                <div className="text-2xl font-extrabold text-gray-800">{totals.totalShipments}</div>
              </div>
            </div>

            <div className="bg-[#f6fffb] rounded-[14px] p-5 shadow-sm border border-[#ddefe7] flex items-center gap-4">
              <div className="bg-teal-500 p-3.5 rounded-2xl text-white shadow-lg shadow-teal-500/30">
                <Truck size={24} />
              </div>
              <div>
                <p className="text-teal-900/60 text-xs font-bold uppercase tracking-wider">In Transit</p>
                <div className="text-2xl font-extrabold text-gray-800">{totals.inTransit}</div>
              </div>
            </div>

            <div className="bg-[#fffaf2] rounded-[14px] p-5 shadow-sm border border-[#f6e7c8] flex items-center gap-4">
              <div className="bg-orange-400 p-3.5 rounded-2xl text-white shadow-lg shadow-orange-400/30">
                <CheckSquare size={24} />
              </div>
              <div>
                <p className="text-orange-900/60 text-xs font-bold uppercase tracking-wider">Delivered</p>
                <div className="text-2xl font-extrabold text-gray-800">{totals.delivered}</div>
              </div>
            </div>

            <div className="bg-[#fff7f7] rounded-[14px] p-5 shadow-sm border border-red-100 flex items-center gap-4 relative overflow-hidden">
              <div className="absolute right-0 top-0 w-16 h-16 bg-red-50 rounded-bl-full -z-10"></div>
              <div className="bg-red-500 p-3.5 rounded-2xl text-white shadow-lg shadow-red-500/30">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-red-900/70 text-xs font-bold uppercase tracking-wider">Temperature Alerts</p>
                <div className="text-2xl font-extrabold text-red-600">{totals.tempAlerts}</div>
              </div>
            </div>
          </div>

          <div id="distributor-tracking" className="mb-6 scroll-mt-24"><LiveShipmentVisualizer compact maxVisible={3} title="Distributor shipment GPS history" /></div>

          <div className="grid grid-cols-1 gap-6 mb-6">
            <div id="distributor-shipments" className="scroll-mt-24 min-w-0 bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">Current Shipments</h3>
                <span className="text-xs text-slate-500">{shownShipments.length} of {shipments.length} shipments</span>
              </div>
              <label className="mb-4 block text-sm text-slate-600">Filter shipments<input className="mt-1 w-full rounded-lg border border-slate-200 p-2" value={search} onChange={event => setSearch(event.target.value)} placeholder="Shipment, batch, destination or status" /></label>
              <p className="mb-3 text-xs text-slate-500">Admin-approved orders create assigned shipments. Verify the batch, dispatch it, then supply the hospital. Holds are enforced by the server.</p>

              <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm text-left">
                  <thead className="text-[11px] text-gray-500 bg-[#f8fbff] uppercase border-b border-[#edf3fa]">
                    <tr>
                      <th className="px-4 py-3 font-semibold rounded-tl-lg">Batch ID</th>
                      <th className="px-4 py-3 font-semibold">Vaccine Type</th>
                      <th className="px-4 py-3 font-semibold">Quantity</th>
                      <th className="px-4 py-3 font-semibold">Destination</th>
                      <th className="px-4 py-3 font-semibold text-center">Status</th>
                      <th className="px-4 py-3 font-semibold rounded-tr-lg text-right">Tx Hash</th>
                      <th className="px-4 py-3 font-semibold">Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownShipments.map((ship) => (
                      <tr key={ship.shipmentId} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{ship.id}<span className="block text-xs text-slate-500">{ship.shipmentId}</span></td>
                        <td className="px-4 py-3 text-gray-600">{ship.type}</td>
                        <td className="px-4 py-3 font-medium text-gray-700">{ship.qty}</td>
                        <td className="px-4 py-3 text-gray-600">{ship.dest}</td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge value={ship.status} />
                        </td>
                        <td className="px-4 py-3 max-w-[130px] break-all text-right font-mono text-xs text-gray-500">{ship.txHash}</td>
                        <td className="px-4 py-3">
                          {ship.held ? <span className="text-xs text-rose-700">Quality hold — review required</span> : ship.confirmed || /confirmed/i.test(ship.workflowStatus) ? <span className="text-xs text-emerald-700">Received by hospital</span> : /supplied|delivered/i.test(ship.workflowStatus) ? <span className="text-xs text-slate-600">Awaiting hospital receipt</span> : <button type="button" disabled={Boolean(pendingAction) || loading} onClick={() => performAction(ship, /transit/i.test(ship.workflowStatus) ? "supply" : /verified/i.test(ship.workflowStatus) ? "dispatch" : "verify")} className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{pendingAction === ship.shipmentId ? "Processing..." : /transit/i.test(ship.workflowStatus) ? "Supply hospital" : /verified/i.test(ship.workflowStatus) ? "Dispatch shipment" : "Verify batch"}</button>}
                        </td>
                      </tr>
                    ))}
                    {!shownShipments.length && (
                      <tr>
                        <td colSpan="7" className="px-4 py-8 text-center text-gray-400">
                          {search ? "No shipments match this search." : "No shipment data available yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div id="distributor-orders" className="scroll-mt-24 bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">Approved Orders Ready for Distribution</h3>
                <span className="text-xs font-semibold text-teal-600">{approvedOrders.length} approved</span>
              </div>
              <div className="space-y-3 mb-5">
                {approvedOrders.map((item) => (
                  <div key={item._id} className="rounded-xl border border-[#edf3fa] bg-[#f7fbff] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-800">{item.orderId}</p>
                        <p className="mt-1 text-sm text-gray-600">
                          {item.hospital} - {item.region}
                        </p>
                      </div>
                      <StatusBadge value={item.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-gray-500">
                      <span>Allocated batch: {item.allocatedBatchId || "See assigned shipment"}</span>
                      <span>Vaccine: {item.vaccineType}</span>
                      <span>Doses: {item.requestedDoses}</span>
                      <span>Risk: {item.riskFlag}</span>
                    </div>
                  </div>
                ))}
                {!approvedOrders.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No approved hospital orders are waiting for distributor action.
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">New Shipment Required Alerts</h3>
                <span className="text-xs font-semibold text-blue-600">{orderNotifications.length} alerts</span>
              </div>
              <div className="space-y-3">
                {orderNotifications.map((item) => (
                  <div key={item._id} className="rounded-xl border border-[#edf3fa] bg-[#f8fbff] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-800">{item.title}</p>
                        <p className="mt-1 text-sm text-gray-600">{item.message}</p>
                      </div>
                      <StatusBadge value="Approved" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-gray-500">
                      <span>Order: {item.orderId}</span>
                      <span>Order audit reference: {item.auditBatchId}</span>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {!orderNotifications.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No approved hospital orders have reached the distributor yet.
                  </div>
                )}
              </div>
            </div>

            <div id="distributor-temperature" className="scroll-mt-24 bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 text-blue-800">
                  <ChartActivity size={20} />
                  <h3 className="font-bold text-gray-800">Temperature Monitoring</h3>
                </div>
              </div>
              <p className="text-xs font-bold text-gray-500 flex items-center gap-2 mb-3 px-2 uppercase tracking-wide">
                <AlertTriangle size={12} /> Latest stored temperature readings
              </p>

              <div className="space-y-3">
                {tempLogs.map((log, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-gray-50 bg-gray-50/50 hover:bg-gray-100 transition-colors">
                    <span className="font-medium text-sm w-20">{log.id}</span>
                    <div className={`${log.bg} text-white font-bold text-xs px-4 py-1.5 rounded w-36 text-center shadow-sm whitespace-nowrap`}>
                      {log.range}
                    </div>
                    <StatusBadge value={log.status} />
                  </div>
                ))}
                {!tempLogs.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No temperature logs available yet.
                  </div>
                )}
              </div>
            </div>

            <div id="distributor-history" className="scroll-mt-24 bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-base">
                  <span className="w-1 h-4 bg-green-500 inline-block rounded"></span>
                  Shipment Activity <span className="text-gray-400 font-normal text-sm ml-1">(Last 7 Days)</span>
                </h3>
              </div>
              <div className="flex-1 min-h-[160px] w-full mt-2">
                <Bar data={deliveryHistoryData} options={deliveryHistoryOptions} />
              </div>
            </div>

            <div className="bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">Hospital Delivery Confirmations</h3>
                <span className="text-xs font-semibold text-emerald-600">{confirmedDeliveries.length} confirmed</span>
              </div>
              <div className="space-y-3">
                {confirmedDeliveries.map((item) => (
                  <div key={`${item.shipmentId}-${item.confirmedAt}`} className="rounded-xl border border-[#edf3fa] bg-[#f8fff9] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-800">{item.shipmentId}</p>
                        <p className="mt-1 text-sm text-gray-600">
                          {item.destination} confirmed batch {item.batchId}
                        </p>
                      </div>
                      <StatusBadge value={item.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-gray-500">
                      <span>{item.vaccineType} - {item.quantity} doses</span>
                      <span>{new Date(item.confirmedAt).toLocaleString()}</span>
                      <span>{item.confirmedBy}</span>
                    </div>
                    <div className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-600">
                      {item.confirmationNote}
                    </div>
                  </div>
                ))}
                {!confirmedDeliveries.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No hospital delivery confirmations yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div id="distributor-alerts" className="scroll-mt-24"><TemperatureAlertPanel role="distributor" /></div>
          <div id="shipment-journey"><TraceabilityPanel /></div>
          <div id="distributor-reports" className="mt-6 scroll-mt-24">
            <BlockchainLog
              title="Distributor Blockchain Audit"
              batchIds={auditBatchIds}
              initialBatchId={auditBatchIds[0]}
              emptyMessage="Distributor lifecycle events will appear here once shipments are logged on-chain."
            />
          </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default DistributorDashboard;
