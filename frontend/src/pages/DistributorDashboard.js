import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Truck, CheckSquare, Search, Bell, User, ChevronDown,
  Shield, FileText, Anchor, Activity as ChartActivity, LogOut, Download, AlertTriangle, Home
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

const destinationCoords = {
  "City Hospital": { lat: 28.61, lng: 77.21, x: 74, y: 34 },
  "District Center": { lat: 19.07, lng: 72.87, x: 54, y: 66 },
  "Block Hospital": { lat: 22.57, lng: 88.36, x: 82, y: 56 },
  "Medical College": { lat: 13.08, lng: 80.27, x: 70, y: 80 },
  "Global Clinic": { lat: 12.97, lng: 77.59, x: 62, y: 82 },
  Kerala: { lat: 10.85, lng: 76.27, x: 45, y: 84 },
  Karnataka: { lat: 15.31, lng: 75.71, x: 49, y: 74 },
  "Tamil Nadu": { lat: 11.12, lng: 78.65, x: 61, y: 86 },
  London: { lat: 51.5, lng: -0.12, x: 18, y: 20 },
  "New York": { lat: 40.71, lng: -74.0, x: 8, y: 28 },
};

function TrackingMap({ markers }) {
  return (
    <div className="relative h-full min-h-[280px] overflow-hidden rounded-xl bg-[linear-gradient(180deg,#edf7ff_0%,#dfefff_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.8),transparent_22%),radial-gradient(circle_at_76%_68%,rgba(255,255,255,0.7),transparent_18%)]" />
      <div className="absolute inset-[8%] rounded-[24px] border border-[#d6e7fa] bg-[linear-gradient(180deg,#f8fcff,#eef6ff)] shadow-inner">
        <div className="absolute left-[8%] top-[16%] h-[58%] w-[30%] rounded-[45%] bg-[#d9ebff] opacity-70 blur-[1px]" />
        <div className="absolute left-[41%] top-[18%] h-[56%] w-[28%] rounded-[42%] bg-[#d2e7ff] opacity-90 blur-[1px]" />
        <div className="absolute left-[62%] top-[22%] h-[42%] w-[18%] rounded-[45%] bg-[#c7def8] opacity-85" />
        <div className="absolute left-[49%] top-[48%] h-[34%] w-[14%] rounded-[45%] bg-[#c2dbf8] opacity-85" />

        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M54 66 C58 58, 64 50, 74 34" stroke="#3b82f6" strokeWidth="0.8" fill="none" strokeDasharray="2 1.6" />
          <path d="M54 66 C55 70, 58 76, 70 80" stroke="#f59e0b" strokeWidth="0.8" fill="none" strokeDasharray="2 1.6" />
          <path d="M54 66 C48 72, 46 78, 45 84" stroke="#10b981" strokeWidth="0.8" fill="none" strokeDasharray="2 1.6" />
          <path d="M54 66 C66 58, 76 58, 82 56" stroke="#ef4444" strokeWidth="0.8" fill="none" strokeDasharray="2 1.6" />
        </svg>

        {markers.map((marker) => (
          <div
            key={marker.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            title={`${marker.dest} - ${marker.id}`}
          >
            <div className="relative flex flex-col items-center">
              <div className="h-4 w-4 rounded-full border-2 border-white shadow-md" style={{ backgroundColor: marker.color }} />
              <div className="mt-1 rounded-md bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[#35567d] shadow-sm">
                {marker.dest}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [markers, setMarkers] = useState([]);
  const [orderNotifications, setOrderNotifications] = useState([]);
  const [approvedOrders, setApprovedOrders] = useState([]);
  const [confirmedDeliveries, setConfirmedDeliveries] = useState([]);
  const { addToast } = useToast();
  const auditBatchIds = useMemo(
    () => [
      ...shipments.map((shipment) => shipment.id),
      ...orderNotifications.map((item) => item.auditBatchId),
      ...approvedOrders.map((item) => item.auditBatchId),
      ...confirmedDeliveries.map((item) => item.batchId),
    ].filter(Boolean),
    [shipments, orderNotifications, approvedOrders, confirmedDeliveries]
  );

  useEffect(() => {
    const load = async () => {
      const [dashboardResult, ordersResult] = await Promise.allSettled([
        fetchDistributorDashboard(),
        fetchDistributorOrders(),
      ]);

      if (dashboardResult.status === "fulfilled") {
        const data = dashboardResult.value;
        const shipmentRows = (data.shipments || []).map((shipment) => ({
          id: shipment.batchId || shipment.shipmentId,
          type: shipment.vaccineType || "Mixed",
          qty: shipment.quantity ? shipment.quantity.toLocaleString() : "--",
          dest: shipment.destination || "N/A",
          status: shipment.status || "Pending",
          txHash: shipment.txHash || "pending",
          statusColor:
            (shipment.status || "").toLowerCase().includes("transit")
              ? "bg-blue-100 text-blue-600"
              : (shipment.status || "").toLowerCase().includes("deliver")
              ? "bg-teal-100 text-teal-600"
              : "bg-orange-100 text-orange-600",
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
        setMarkers(
          (data.shipments || []).map((shipment) => ({
            id: shipment.batchId || shipment.shipmentId,
            dest: shipment.destination,
            x: destinationCoords[shipment.destination]?.x || 54,
            y: destinationCoords[shipment.destination]?.y || 66,
            color:
              (shipment.status || "").toLowerCase().includes("deliver")
                ? "#10b981"
                : (shipment.status || "").toLowerCase().includes("transit")
                ? "#3b82f6"
                : "#f59e0b",
          }))
        );
      } else {
        setShipments([]);
        setTempLogs([]);
        setMarkers([]);
        setConfirmedDeliveries([]);
        setTotals({ totalShipments: 0, inTransit: 0, delivered: 0, pending: 0, tempAlerts: 0 });
        setDeliveryHistory(defaultDeliveryHistory);
        setDeliveryLabels(defaultLabels);
        addToast("error", "Distributor dashboard failed to load");
      }

      if (ordersResult.status === "fulfilled") {
        setOrderNotifications(ordersResult.value.notifications || []);
        setApprovedOrders(ordersResult.value.orders || []);
      } else {
        setOrderNotifications([]);
        setApprovedOrders([]);
        addToast("error", "Approved hospital order feed could not be loaded");
      }
    };

    load();
  }, [addToast]);

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
    <div className="min-h-screen bg-[linear-gradient(180deg,#eef5fd_0%,#f8fbff_42%,#f4f8fd_100%)] font-sans text-gray-800">
      <header className="bg-gradient-to-r from-[#103968] via-[#154986] to-[#1f6bbb] text-white flex items-center justify-between px-6 py-3 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-white p-1.5 text-[#153e75] rounded-full shadow-inner">
            <Shield size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-wide">2026 Smart Vaccine Supply Chain System</h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search..."
              className="pl-9 pr-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-sm focus:outline-none focus:bg-white/20 transition-all text-white placeholder-white/60 w-64"
            />
          </div>
          <div className="relative cursor-pointer">
            <Bell size={20} />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold">{totals.tempAlerts}</div>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium border-l border-white/20 pl-4">
            <span className="hidden sm:inline">Distributor</span>
            <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center">
              <User size={18} />
            </div>
            <ChevronDown size={16} className="cursor-pointer" />
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="w-60 bg-[linear-gradient(180deg,#193f74,#1c4f8b_62%,#1f5c9f)] min-h-[calc(100vh-64px)] text-white/90 shadow-2xl z-40 flex flex-col pt-6 flex-shrink-0">
          <div className="mx-3 mb-4 rounded-2xl bg-[#2870c4] px-4 py-4 text-white shadow-lg shadow-blue-900/20">
            <div className="text-xl font-bold leading-tight">Distributor Dashboard</div>
          </div>

          <nav className="flex flex-col gap-1 px-3 flex-1">
            <Link to="#" className="flex items-center gap-3 bg-white text-[#1e4881] px-4 py-3 rounded-xl font-bold shadow-md transform -translate-x-1">
              <Home size={18} />
              <span>Dashboard</span>
            </Link>
            <Link to="#" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <Truck size={18} />
              <span>Shipments</span>
            </Link>
            <Link to="#" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <LogOut size={18} className="rotate-180" />
              <span>Batch Tracking</span>
            </Link>
            <Link to="#" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <ChartActivity size={18} />
              <span>Temperature Logs</span>
            </Link>
            <Link to="#" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <FileText size={18} />
              <span>Delivery History</span>
            </Link>
            <Link to="#" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium">
              <Shield size={18} />
              <span>Reports</span>
            </Link>
            <Link to="/" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors font-medium mt-auto mb-4">
              <Anchor size={18} />
              <span>Logout</span>
            </Link>
          </nav>

          <div className="h-52 relative overflow-hidden flex items-end justify-center bg-gradient-to-t from-blue-950/55 to-transparent p-4">
            <div className="absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.1),transparent_24%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.12),transparent_25%)]"></div>
            <div className="w-16 h-32 bg-white/10 border-2 border-white/20 rounded-t-xl relative overflow-hidden backdrop-blur-md shadow-xl">
              <div className="absolute bottom-0 w-full bg-blue-400 h-2/3 opacity-80 mix-blend-overlay"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50 text-xs font-bold rotate-90 tracking-widest uppercase">COLD CHAIN</div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-x-hidden p-6 lg:p-8">
          <div className="mx-auto max-w-[1240px]">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-[1.95rem] text-gray-800 font-bold">Distributor Dashboard</h2>
            <button className="flex items-center gap-2 text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg font-medium text-sm transition-colors border border-blue-200">
              <Download size={16} /> Export Report
            </button>
          </div>

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

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-6">
            <div className="xl:col-span-3 bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">Current Shipments</h3>
                <button className="text-blue-600 text-sm font-semibold border border-blue-100 px-3 py-1 rounded hover:bg-blue-50 transition-colors">View All</button>
              </div>

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
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map((ship, idx) => (
                      <tr key={idx} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{ship.id}</td>
                        <td className="px-4 py-3 text-gray-600">{ship.type}</td>
                        <td className="px-4 py-3 font-medium text-gray-700">{ship.qty}</td>
                        <td className="px-4 py-3 text-gray-600">{ship.dest}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide inline-block w-28 ${ship.statusColor}`}>
                            {ship.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[10px] text-gray-400">{ship.txHash}</td>
                      </tr>
                    ))}
                    {!shipments.length && (
                      <tr>
                        <td colSpan="6" className="px-4 py-8 text-center text-gray-400">
                          No shipment data available yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="xl:col-span-2 bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">Shipment Tracking Map</h3>
                <span className="text-gray-400 cursor-pointer">...</span>
              </div>
              <div className="flex-1 rounded-xl overflow-hidden border border-blue-100/50 min-h-[280px] shadow-inner">
                <TrackingMap markers={markers} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5">
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
                      <span className="rounded-md bg-teal-100 px-2.5 py-1 text-[11px] font-semibold text-teal-700">
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-gray-500">
                      <span>Batch: {item.auditBatchId}</span>
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
                      <span className="rounded-md bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                        Approved
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-gray-500">
                      <span>Order: {item.orderId}</span>
                      <span>Batch: {item.auditBatchId}</span>
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

            <div className="bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 text-blue-800">
                  <ChartActivity size={20} />
                  <h3 className="font-bold text-gray-800">Temperature Monitoring</h3>
                </div>
                <span className="text-gray-400 cursor-pointer">...</span>
              </div>
              <p className="text-xs font-bold text-gray-500 flex items-center gap-2 mb-3 px-2 uppercase tracking-wide">
                <AlertTriangle size={12} /> Temperature Logs (24/7)
              </p>

              <div className="space-y-3">
                {tempLogs.map((log, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-gray-50 bg-gray-50/50 hover:bg-gray-100 transition-colors">
                    <span className="font-medium text-sm w-20">{log.id}</span>
                    <div className={`${log.bg} text-white font-bold text-xs px-4 py-1.5 rounded w-36 text-center shadow-sm whitespace-nowrap`}>
                      {log.range}
                    </div>
                    <span className={`text-xs font-bold px-3 py-1 rounded w-20 text-center ${log.badge}`}>
                      {log.status}
                    </span>
                  </div>
                ))}
                {!tempLogs.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No temperature logs available yet.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[14px] shadow-sm border border-[#e9eff7] p-5 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-base">
                  <span className="w-1 h-4 bg-green-500 inline-block rounded"></span>
                  Delivery History <span className="text-gray-400 font-normal text-sm ml-1">(Last 7 Days)</span>
                </h3>
                <span className="text-gray-400 cursor-pointer">...</span>
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
                      <span className="rounded-md bg-teal-100 px-2.5 py-1 text-[11px] font-semibold text-teal-700">
                        {item.status}
                      </span>
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

          <div className="mt-6">
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
