import React, { useCallback, useEffect, useMemo, useState } from "react";
import TemperatureAlertPanel from "../components/TemperatureAlertPanel";
import { Link } from "react-router-dom";
import {
  Activity,
  Bell,
  ClipboardCheck,
  Database,
  FileCheck2,
  Home,
  LogOut,
  PackageCheck,
  Shield,
  Syringe,
  User,
} from "lucide-react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import { useToast } from "../components/Toast";
import { fetchHealthcareDashboard } from "../services/dashboard";
import {
  fetchVaccinationWorkflow,
  runVaccinationWorkflow,
  createHospitalOrder,
  fetchHospitalOrders,
  confirmHospitalDelivery,
} from "../services/workflow";
import BlockchainLog from "../components/BlockchainLog";
import FeedbackForm from "../components/Healthcare/FeedbackForm";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("reported")) return "bg-[#e8f7ef] text-[#2ea67f]";
  if (normalized.includes("administered")) return "bg-[#eef5ff] text-[#3278d7]";
  if (normalized.includes("updated")) return "bg-[#fff4df] text-[#cf8a26]";
  return "bg-[#f1f5f9] text-[#64748b]";
}

function orderTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("approved")) return "bg-[#e8f7ef] text-[#2ea67f]";
  if (normalized.includes("declined")) return "bg-[#fff0f0] text-[#d85a5a]";
  return "bg-[#eef5ff] text-[#3278d7]";
}

function HospitalDashboard() {
  const [cards, setCards] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [daily, setDaily] = useState([]);
  const [dailyLabels, setDailyLabels] = useState(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const [stockDetails, setStockDetails] = useState([]);
  const [incomingDeliveries, setIncomingDeliveries] = useState([]);
  const [recentConfirmedDeliveries, setRecentConfirmedDeliveries] = useState([]);
  const [workflowData, setWorkflowData] = useState({
    requests: [],
    inventory: [],
    administrations: [],
    reports: [],
  });
  const [hospitalOrders, setHospitalOrders] = useState([]);
  const [hospitalNotifications, setHospitalNotifications] = useState([]);
  const [deliveryNotes, setDeliveryNotes] = useState({});
  const [form, setForm] = useState({
    centerId: "City Hospital",
    hospital: "City Hospital",
    batchId: "BATCH9010",
    vaccineType: "Covid-19",
    requestedDoses: 300,
    receivedDoses: 250,
    dosesUsed: 120,
    stockBefore: 80,
    patientName: "Patient Demo",
    healthAuthority: "State Health Authority",
  });
  const [orderForm, setOrderForm] = useState({
    hospital: "City Hospital",
    centerId: "City Hospital",
    region: "Northeast Region",
    vaccineType: "Covid-19",
    requestedDoses: 500,
    priority: "High",
    notes: "Urgent district requirement due to rising vaccination demand.",
  });
  const { addToast } = useToast();
  const submittedByContext = useMemo(
    () => localStorage.getItem("userEmail") || "healthcare@test.com",
    []
  );
  const auditBatchIds = useMemo(() => {
    const ids = [
      ...hospitalOrders.map((item) => item.auditBatchId),
      ...workflowData.requests.map((item) => item.batchId),
      ...workflowData.inventory.map((item) => item.batchId),
      ...workflowData.administrations.map((item) => item.batchId),
      ...workflowData.reports.map((item) => item.batchId),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [hospitalOrders, workflowData]);
  const feedbackBatchSuggestions = useMemo(() => {
    const ids = [
      ...incomingDeliveries.map((item) => item.batchId),
      ...hospitalOrders.map((item) => item.auditBatchId),
      ...workflowData.inventory.map((item) => item.batchId),
      ...workflowData.reports.map((item) => item.batchId),
      ...workflowData.requests.map((item) => item.batchId),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [incomingDeliveries, hospitalOrders, workflowData]);

  const loadPage = useCallback(async () => {
    const [dashboardData, workflow, orderData] = await Promise.all([
      fetchHealthcareDashboard(),
      fetchVaccinationWorkflow(),
      fetchHospitalOrders(orderForm.hospital),
    ]);

    setCards(dashboardData.cards);
    setAppointments(dashboardData.appointments || []);
    setDaily(dashboardData.dailyProgress || []);
    setDailyLabels(dashboardData.dailyLabels || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    setStockDetails(dashboardData.stockDetails || []);
    setIncomingDeliveries(dashboardData.incomingDeliveries || []);
    setRecentConfirmedDeliveries(dashboardData.recentConfirmedDeliveries || []);
    setWorkflowData(workflow);
    setHospitalOrders(orderData.orders || []);
    setHospitalNotifications(orderData.notifications || []);
  }, [orderForm.hospital]);

  useEffect(() => {
    loadPage().catch(() => addToast("error", "Healthcare workflow failed to load"));
  }, [addToast, loadPage]);

  const runWorkflow = async () => {
    try {
      await runVaccinationWorkflow({
        ...form,
        requestedDoses: Number(form.requestedDoses),
        receivedDoses: Number(form.receivedDoses),
        dosesUsed: Number(form.dosesUsed),
        stockBefore: Number(form.stockBefore),
      });
      addToast("success", "Vaccination workflow completed");
      await loadPage();
    } catch (_err) {
      addToast("error", "Unable to complete vaccination workflow");
    }
  };

  const submitOrder = async () => {
    try {
      await createHospitalOrder({
        ...orderForm,
        requestedDoses: Number(orderForm.requestedDoses),
      });
      addToast("success", "Hospital vaccine order submitted");
      await loadPage();
    } catch (_err) {
      addToast("error", "Unable to submit hospital order");
    }
  };

  const confirmDelivery = async (shipment) => {
    try {
      const result = await confirmHospitalDelivery(shipment.shipmentId, {
        hospital: orderForm.hospital,
        confirmationNote:
          deliveryNotes[shipment.shipmentId] || `Delivery received successfully for ${shipment.batchId}.`,
      });
      const confirmed = result.confirmedInventory;
      addToast(
        "success",
        confirmed
          ? `${confirmed.receivedDoses} doses of ${confirmed.vaccineType} added. Current stock: ${confirmed.stockAfter}`
          : "Distributor delivery confirmed"
      );
      await loadPage();
    } catch (_err) {
      addToast("error", "Unable to confirm distributor delivery");
    }
  };

  const stockData = useMemo(() => ({
    labels: stockDetails.map((item) => `${item.vaccineType} (${item.available})`),
    datasets: [
      {
        data: stockDetails.map((item) => item.available),
        backgroundColor: ["#2563eb", "#10b981", "#f59e0b", "#9333ea", "#ef4444", "#06b6d4"],
        borderWidth: 0,
      },
    ],
  }), [stockDetails]);

  const stockChartKey = useMemo(
    () => JSON.stringify(stockDetails.map((item) => `${item.vaccineType}:${item.available}`)),
    [stockDetails]
  );

  const totalAvailableStock = useMemo(
    () => stockDetails.reduce((sum, item) => sum + item.available, 0),
    [stockDetails]
  );

  const latestConfirmedStock = recentConfirmedDeliveries[0];

  const stockChartOptions = useMemo(
    () => ({
      plugins: {
        legend: {
          position: "top",
          labels: {
            boxWidth: 14,
            color: "#4b5563",
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.raw || 0);
              return `${context.label}: ${value} doses`;
            },
          },
        },
      },
      cutout: "62%",
      maintainAspectRatio: true,
    }),
    []
  );

  const dailyData = useMemo(() => ({
    labels: dailyLabels,
    datasets: [
      {
        data: daily,
        backgroundColor: "#22c55e",
        borderRadius: 6,
      },
    ],
  }), [daily, dailyLabels]);

  const workflowSteps = [
    { key: "requests", title: "1.1 Vaccine Request", icon: Database },
    { key: "inventory", title: "1.2 Stock Management", icon: PackageCheck },
    { key: "administrations", title: "1.3 Administer Vaccines", icon: Syringe },
    { key: "reports", title: "1.4 Record & Report", icon: FileCheck2 },
  ];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#eef4fb_0%,#f7fbff_38%,#f3f7fc_100%)] text-[#32435b]">
      <header className="h-16 bg-gradient-to-r from-[#0c4d96] via-[#2376cb] to-[#3b95e6] px-6 text-white shadow-sm">
        <div className="flex h-full items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/15">
              <Shield size={20} />
            </div>
            <h1 className="text-[1.45rem] font-semibold tracking-wide">2026 Smart Vaccine Supply Chain System</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="relative">
              <Bell size={18} />
              <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#ff6d6d] text-[10px]">
                {workflowData.reports.length}
              </span>
            </div>
            <span>Vaccination Center</span>
            <User size={20} />
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="w-[120px] min-h-[calc(100vh-64px)] bg-gradient-to-b from-[#124e97] to-[#206eb9] text-white shadow-xl">
          <nav className="space-y-2 px-3 pt-6 text-[13px]">
            <Link to="#" className="flex items-center gap-2 rounded-lg bg-white/12 px-3 py-3">
              <Home size={15} />
              <span>Dashboard</span>
            </Link>
            <Link to="#" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <ClipboardCheck size={15} />
              <span>Workflow</span>
            </Link>
            <Link to="#" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <Syringe size={15} />
              <span>Vaccinate</span>
            </Link>
            <Link to="#" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <Activity size={15} />
              <span>Reports</span>
            </Link>
            <Link to="/" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <LogOut size={15} />
              <span>Logout</span>
            </Link>
          </nav>
        </aside>

        <main className="flex-1 px-5 py-5">
          <div className="mx-auto max-w-[1240px]">
            <div className="mb-1 text-[12px] text-[#92a0b2]">Home / Dashboard</div>
            <h2 className="mb-5 text-[1.95rem] font-semibold text-[#2d4a73]">Vaccination Center Dashboard</h2>

            {cards && (
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Vaccines Available</p>
                  <div className="text-2xl font-bold text-indigo-600">{cards.vaccinesAvailable}</div>
                </div>
                <div className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Today's Appointments</p>
                  <div className="text-2xl font-bold text-emerald-600">{cards.todaysAppointments}</div>
                </div>
                <div className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Vaccinated Today</p>
                  <div className="text-2xl font-bold text-amber-600">{cards.vaccinatedToday}</div>
                </div>
                <div className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Low Stock Alerts</p>
                  <div className="text-2xl font-bold text-rose-600">{cards.lowAlerts}</div>
                </div>
              </div>
            )}

            <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-4">
              {workflowSteps.map(({ key, title, icon: Icon }) => {
                const items = workflowData[key] || [];
                const latest = items[0];
                return (
                  <div key={key} className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef5ff] text-[#3178d5]">
                        <Icon size={20} />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-[#42566f]">{title}</p>
                        <p className="text-xs text-[#8a9ab0]">{items.length} records</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${statusTone(
                        latest?.recordStatus || latest?.administrationStatus || latest?.inventoryStatus || latest?.requestStatus
                      )}`}>
                        {latest?.recordStatus || latest?.administrationStatus || latest?.inventoryStatus || latest?.requestStatus || "Pending"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Hospital Vaccine Order</h4>
                <p className="mb-4 text-sm text-slate-500">
                  Submit a vaccine order for admin review. Admin decisions will notify the hospital, and distributors only see approved orders.
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={orderForm.hospital} placeholder="Hospital" onChange={(e) => setOrderForm({ ...orderForm, hospital: e.target.value, centerId: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={orderForm.region} placeholder="Region" onChange={(e) => setOrderForm({ ...orderForm, region: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={orderForm.vaccineType} placeholder="Vaccine Type" onChange={(e) => setOrderForm({ ...orderForm, vaccineType: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" type="number" value={orderForm.requestedDoses} placeholder="Requested Doses" onChange={(e) => setOrderForm({ ...orderForm, requestedDoses: e.target.value })} />
                  <select className="rounded-xl border border-slate-200 px-3 py-2" value={orderForm.priority} onChange={(e) => setOrderForm({ ...orderForm, priority: e.target.value })}>
                    <option>High</option>
                    <option>Normal</option>
                    <option>Low</option>
                  </select>
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={orderForm.centerId} placeholder="Center ID" onChange={(e) => setOrderForm({ ...orderForm, centerId: e.target.value })} />
                </div>
                <textarea className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2" rows={3} value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} />
                <button className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-white" onClick={submitOrder}>
                  Submit Vaccine Order
                </button>
              </div>

              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Vaccination Workflow Trigger</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={form.centerId} placeholder="Center" onChange={(e) => setForm({ ...form, centerId: e.target.value, hospital: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={form.batchId} placeholder="Batch ID" onChange={(e) => setForm({ ...form, batchId: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={form.vaccineType} placeholder="Vaccine Type" onChange={(e) => setForm({ ...form, vaccineType: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" value={form.patientName} placeholder="Patient Name" onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" type="number" value={form.requestedDoses} placeholder="Requested Doses" onChange={(e) => setForm({ ...form, requestedDoses: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" type="number" value={form.receivedDoses} placeholder="Received Doses" onChange={(e) => setForm({ ...form, receivedDoses: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" type="number" value={form.dosesUsed} placeholder="Doses Used" onChange={(e) => setForm({ ...form, dosesUsed: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2" type="number" value={form.stockBefore} placeholder="Stock Before" onChange={(e) => setForm({ ...form, stockBefore: e.target.value })} />
                </div>
                <button className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-white" onClick={runWorkflow}>
                  Run Vaccination Workflow
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:col-span-2">
              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Stock Level</h4>
                <div className="relative">
                  <Doughnut key={stockChartKey} data={stockData} options={stockChartOptions} />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Available</div>
                    <div className="text-3xl font-bold text-[#2d4a73]">{totalAvailableStock}</div>
                    <div className="text-xs text-slate-500">doses</div>
                  </div>
                </div>
                {latestConfirmedStock ? (
                  <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Last confirmed: <span className="font-semibold">{latestConfirmedStock.receivedDoses} doses of {latestConfirmedStock.vaccineType}</span>
                  </div>
                ) : null}
                <div className="mt-4 space-y-2">
                  {stockDetails.map((item) => (
                    <div key={item.vaccineType} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <div>
                        <div className="font-semibold text-slate-700">{item.vaccineType}</div>
                        <div className="text-xs text-slate-500">
                          Received {item.received} / Used {item.used}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-[#2d4a73]">{item.available}</div>
                        <div className="text-xs text-slate-500">available</div>
                      </div>
                    </div>
                  ))}
                  {!stockDetails.length && (
                    <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
                      Confirm a delivery to populate vaccine stock by type.
                    </div>
                  )}
                </div>
              </div>
                <div className="rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
                  <h4 className="mb-3 font-semibold text-slate-800">Daily Vaccination Progress</h4>
                  <div className="h-64">
                    <Bar data={dailyData} options={{ plugins: { legend: { display: false } } }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Submitted Vaccine Orders</h4>
                <div className="space-y-3">
                  {hospitalOrders.map((order) => (
                    <div key={order._id} className="rounded-xl border border-slate-100 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-800">{order.orderId}</p>
                          <p className="text-sm text-slate-500">{order.region} - {order.vaccineType}</p>
                        </div>
                        <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${orderTone(order.status)}`}>
                          {order.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-600">
                        <span>Doses: {order.requestedDoses}</span>
                        <span>Risk: {order.riskFlag}</span>
                        <span>Sentiment: {Number(order.sentimentScore || 0).toFixed(2)}</span>
                      </div>
                      {order.adminDecisionNote ? (
                        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          Admin Note: {order.adminDecisionNote}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!hospitalOrders.length && (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                      No hospital orders submitted yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Hospital Notifications</h4>
                <div className="space-y-3">
                  {hospitalNotifications.map((item) => (
                    <div key={item._id} className="rounded-xl border border-slate-100 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-800">{item.title}</p>
                        <span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{item.message}</p>
                    </div>
                  ))}
                  {!hospitalNotifications.length && (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                      No notifications yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-5">
              <FeedbackForm
                healthcareCenter={orderForm.hospital}
                region={orderForm.region}
                submittedBy={submittedByContext}
                batchSuggestions={feedbackBatchSuggestions}
                appointments={appointments}
              />
            </div>

            <div className="mb-5 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
              <h4 className="mb-3 font-semibold text-slate-800">Confirm Delivery from Distributor</h4>
              <div className="space-y-3">
                {incomingDeliveries.map((shipment) => (
                  <div key={shipment.shipmentId} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-800">{shipment.shipmentId}</p>
                        <p className="text-sm text-slate-500">
                          {shipment.batchId} - {shipment.vaccineType} - {shipment.quantity} doses
                        </p>
                      </div>
                      <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${orderTone(shipment.status)}`}>
                        {shipment.coldChainStatus || shipment.status}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Delivery confirmation note"
                        value={deliveryNotes[shipment.shipmentId] || ""}
                        onChange={(e) =>
                          setDeliveryNotes((current) => ({
                            ...current,
                            [shipment.shipmentId]: e.target.value,
                          }))
                        }
                      />
                      <button
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-white"
                        onClick={() => confirmDelivery(shipment)}
                      >
                        Confirm Received
                      </button>
                    </div>
                  </div>
                ))}
                {!incomingDeliveries.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                    No distributor deliveries are waiting for hospital confirmation.
                  </div>
                )}
              </div>
            </div>

            <div className="mb-5 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
              <h4 className="mb-3 font-semibold text-slate-800">Recently Confirmed Deliveries</h4>
              <div className="space-y-3">
                {recentConfirmedDeliveries.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-800">{item.shipmentId || item.batchId}</p>
                        <p className="text-sm text-slate-500">
                          {item.vaccineType} - {item.receivedDoses} doses received
                        </p>
                      </div>
                      <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        Stock {item.stockBefore} -> {item.stockAfter}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-500">
                      <span>{item.hospital}</span>
                      <span>{new Date(item.date).toLocaleString()}</span>
                    </div>
                    {item.notes ? (
                      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {item.notes}
                      </div>
                    ) : null}
                  </div>
                ))}
                {!recentConfirmedDeliveries.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                    No confirmed deliveries yet.
                  </div>
                )}
              </div>
            </div>

            <div className="mb-5 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
              <h4 className="mb-3 font-semibold text-slate-800">Upcoming Appointments</h4>
              <div className="space-y-2">
                {appointments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                    <div>
                      <p className="font-semibold text-slate-800">{a.name}</p>
                      <p className="text-sm text-slate-500">{a.vaccine}</p>
                    </div>
                    <span className="text-sm text-slate-600">{a.time}</span>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">{a.status}</span>
                  </div>
                ))}
                {!appointments.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                    No upcoming appointments available yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
              <h4 className="mb-3 font-semibold text-slate-800">Workflow Logs</h4>
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2">Stage</th>
                      <th className="py-2">Center</th>
                      <th className="py-2">Batch</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...workflowData.reports, ...workflowData.administrations, ...workflowData.inventory, ...workflowData.requests].map((r) => (
                      <tr key={r._id} className="border-t">
                        <td className="py-2">{r.workflowStage}</td>
                        <td className="py-2">{r.hospital || r.centerId}</td>
                        <td className="py-2">{r.batchId || "--"}</td>
                        <td className="py-2">
                          {r.recordStatus || r.administrationStatus || r.inventoryStatus || r.requestStatus}
                        </td>
                        <td className="py-2">{new Date(r.date).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <TemperatureAlertPanel role="healthcare" />
            <div className="mt-5">
              <BlockchainLog
                title="Vaccination Center Blockchain Audit"
                batchIds={auditBatchIds}
                initialBatchId={auditBatchIds[0]}
                emptyMessage="Run the vaccination workflow to display a live blockchain timeline here."
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default HospitalDashboard;
