import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TemperatureAlertPanel from "../components/TemperatureAlertPanel";
import LiveShipmentVisualizer from "../components/LiveShipmentVisualizer";
import TraceabilityPanel from "../components/TraceabilityPanel";
import StatusBadge from "../components/StatusBadge";
import { LogoutButton } from "../components/SessionControls";
import {
  Activity,
  Bell,
  ClipboardCheck,
  Database,
  FileCheck2,
  Home,
  PackageCheck,
  QrCode,
  Shield,
  Syringe,
  User,
  RefreshCw,
  Download,
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
import { downloadOperationalCsv } from "../services/operationalExport";
import { vaccinationOperationId, clearVaccinationOperation } from "../services/vaccinationOperation";
import BatchVerificationPanel from "../components/BatchVerificationPanel";
import ManualReadingEntry from "../components/ManualReadingEntry";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

function workflowStatus(record) {
  if (!record) return "Pending";
  const values = [record.recordStatus, record.administrationStatus, record.inventoryStatus, record.requestStatus];
  return values.find(value => value && value !== "Pending") || "Pending";
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
  const [hospitalIdentity, setHospitalIdentity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [uncertainOperation, setUncertainOperation] = useState("");
  const operationLock = useRef(false);
  const [formErrors, setFormErrors] = useState({});
  const [form, setForm] = useState({
    batchId: "",
    vaccineType: "",
    dosesUsed: "",
    patientName: "",
    healthAuthority: "",
    notes: "",
  });
  const [orderForm, setOrderForm] = useState({
    region: "",
    vaccineType: "",
    requestedDoses: "",
    priority: "Normal",
    notes: "",
  });
  const { addToast } = useToast();
  const submittedByContext = useMemo(
    () => sessionStorage.getItem("userEmail") || "",
    []
  );
  const auditBatchIds = useMemo(() => {
    const ids = [
      ...hospitalOrders.map((item) => item.allocatedBatchId),
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
      ...hospitalOrders.map((item) => item.allocatedBatchId),
      ...workflowData.inventory.map((item) => item.batchId),
      ...workflowData.reports.map((item) => item.batchId),
      ...workflowData.requests.map((item) => item.batchId),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [incomingDeliveries, hospitalOrders, workflowData]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
    const [dashboardData, workflow, orderData] = await Promise.all([
      fetchHealthcareDashboard(),
      fetchVaccinationWorkflow(),
      fetchHospitalOrders(),
    ]);

    setCards(dashboardData.cards);
    setHospitalIdentity(dashboardData.identity?.hospital || "");
    setAppointments(dashboardData.appointments || []);
    setDaily(dashboardData.dailyProgress || []);
    setDailyLabels(dashboardData.dailyLabels || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    setStockDetails(dashboardData.stockDetails || []);
    setIncomingDeliveries(dashboardData.incomingDeliveries || []);
    setRecentConfirmedDeliveries(dashboardData.recentConfirmedDeliveries || []);
    setWorkflowData({ requests: [], inventory: [], administrations: [], reports: [], ...workflow });
    setHospitalOrders(orderData.orders || []);
    setHospitalNotifications(orderData.notifications || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadPage().catch(() => { setError("Healthcare data could not be loaded. Check the backend and your signed-in role, then refresh."); addToast("error", "Healthcare workflow failed to load"); });
  }, [addToast, loadPage]);

  const saveOperation = async (key, action, successMessage) => {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(key);
    setError("");
    try {
      await action();
      addToast("success", successMessage);
      try { await loadPage(); } catch (_error) { setError("The action was saved, but the dashboard could not refresh. Refresh the dashboard; do not submit the action again."); }
    } catch (error) {
      const message = error.response?.data?.error || error.message || "The request could not be completed.";
      if (!error.response || error.response.status >= 500 || error.response.data?.code === "VACCINATION_OPERATION_INCOMPLETE") setUncertainOperation(key);
      setError(`${message}${!error.response || error.response.status >= 500 ? " Refresh and inspect existing records before retrying because part of the operation may have been saved." : ""}`);
      addToast("error", message);
    } finally {
      setBusy("");
      operationLock.current = false;
    }
  };

  const confirmedBatches = useMemo(() => {
    const receipts = workflowData.inventory.filter(item => item.eventType === "Delivery Confirmation");
    const batches = new Map();
    const seen = new Set();
    receipts.forEach(item => {
      if (!item.batchId || seen.has(item.shipmentId || item._id)) return;
      seen.add(item.shipmentId || item._id);
      const row = batches.get(item.batchId) || { batchId: item.batchId, vaccineType: item.vaccineType, received: 0 };
      row.received += Number(item.receivedDoses || 0);
      batches.set(item.batchId, row);
    });
    return Array.from(batches.values()).map(item => ({ ...item, available: Math.max(0, item.received - workflowData.administrations.filter(row => row.batchId === item.batchId).reduce((total, row) => total + Number(row.dosesUsed || 0), 0)) }));
  }, [workflowData]);
  const selectedBatch = confirmedBatches.find(item => item.batchId === form.batchId);
  const runWorkflow = event => {
    event.preventDefault();
    const invalid = {};
    if (!selectedBatch) invalid.workflow = "Choose a batch received and confirmed by your hospital.";
    if (!form.patientName.trim() || !form.healthAuthority.trim()) invalid.workflow = "Enter a synthetic patient reference and reporting authority.";
    if (!Number.isSafeInteger(Number(form.dosesUsed)) || Number(form.dosesUsed) <= 0 || Number(form.dosesUsed) > (selectedBatch?.available || 0)) invalid.workflow = "Doses used must be a positive whole number within the confirmed available stock.";
    setFormErrors(invalid);
    if (Object.keys(invalid).length) return;
    saveOperation("vaccinate", async () => {
      const payload = { ...form, patientName: form.patientName.trim(), healthAuthority: form.healthAuthority.trim(), vaccineType: selectedBatch.vaccineType, requestedDoses: 0, receivedDoses: 0, dosesUsed: Number(form.dosesUsed) };
      const operationId = await vaccinationOperationId(payload);
      await runVaccinationWorkflow({ ...payload, operationId });
      clearVaccinationOperation(operationId);
      setForm(current => ({ ...current, dosesUsed: "", patientName: "", notes: "" }));
    }, "Vaccination and report saved");
  };
  const submitOrder = event => {
    event.preventDefault();
    const invalid = {};
    if (!orderForm.region.trim() || !orderForm.vaccineType.trim()) invalid.order = "Enter the region and vaccine type.";
    if (!Number.isSafeInteger(Number(orderForm.requestedDoses)) || Number(orderForm.requestedDoses) <= 0) invalid.order = "Requested doses must be a positive whole number.";
    setFormErrors(invalid);
    if (Object.keys(invalid).length) return;
    saveOperation("order", async () => { await createHospitalOrder({ ...orderForm, region: orderForm.region.trim(), vaccineType: orderForm.vaccineType.trim(), notes: orderForm.notes.trim(), requestedDoses: Number(orderForm.requestedDoses) }); setOrderForm(current => ({ ...current, requestedDoses: "", notes: "" })); }, "Hospital vaccine order submitted");
  };

  const confirmDelivery = async (shipment) => {
    await saveOperation(shipment.shipmentId, async () => {
      const result = await confirmHospitalDelivery(shipment.shipmentId, {
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
    }, "Delivery receipt saved");
  };

  const refreshPage = () => { setError(""); loadPage().then(() => setUncertainOperation("")).catch(() => setError("Unable to refresh healthcare data. Check the backend connection.")); };
  const exportReports = () => downloadOperationalCsv("healthcare-workflow.csv", ["Stage", "Hospital", "Batch", "Status", "Date"], [...workflowData.reports, ...workflowData.administrations, ...workflowData.inventory, ...workflowData.requests].map(row => [row.workflowStage, row.hospital || row.centerId, row.batchId, workflowStatus(row), row.date]));

  const stockData = useMemo(() => ({
    labels: stockDetails.map((item) => `${item.vaccineType} (${item.available})`),
    datasets: [
      {
        data: stockDetails.map((item) => item.available),
        backgroundColor: ["#438f66", "#10b981", "#f59e0b", "#9333ea", "#ef4444", "#06b6d4"],
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
    <div className="dashboard-page min-h-screen bg-[linear-gradient(180deg,#eef4fb_0%,#f7fbff_38%,#f3f7fc_100%)] text-[#32435b]">
      <div className="mx-auto max-w-[1500px] px-5"><ManualReadingEntry allowManual={false} /></div>
      <header className="dashboard-header h-16 bg-gradient-to-r from-[#0c4d96] via-[#2376cb] to-[#3b95e6] px-6 text-white shadow-sm">
        <div className="flex h-full items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/15">
              <Shield size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-wide">Vaccine Supply Chain</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="#hospital-notifications" aria-label="View hospital notifications" className="relative">
              <Bell size={18} />
              <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#ff6d6d] text-[10px]">
                {hospitalNotifications.length}
              </span>
            </a>
            <span>Vaccination Center</span>
            <User size={20} />
          </div>
        </div>
      </header>

      <div className="dashboard-layout flex">
        <aside className="dashboard-sidebar w-56 min-h-[calc(100vh-64px)] bg-gradient-to-b from-[#124e97] to-[#206eb9] text-white shadow-xl">
          <nav className="space-y-2 px-3 pt-6 text-[13px]">
            <a href="#hospital-overview" className="flex items-center gap-2 rounded-lg bg-white/12 px-3 py-3">
              <Home size={15} />
              <span>Dashboard</span>
            </a>
            <a href="#hospital-orders" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <ClipboardCheck size={15} />
              <span>Workflow</span>
            </a>
            <a href="#hospital-vaccinate" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <Syringe size={15} />
              <span>Vaccinate</span>
            </a>
            <a href="#hospital-reports" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <Activity size={15} />
              <span>Reports</span>
            </a>
            <a href="#hospital-deliveries" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10"><PackageCheck size={15} />Deliveries</a>
            <a href="#hospital-batch-verification" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10"><QrCode size={15} />Verify batch QR</a>
            <a href="#hospital-feedback" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10"><FileCheck2 size={15} />Feedback</a>
            <a href="#hospital-alerts" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10"><Bell size={15} />Cold-chain alerts</a>
            <LogoutButton className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10" />
          </nav>
        </aside>

        <main className="dashboard-main min-w-0 flex-1 px-5 py-5">
          <div className="dashboard-content mx-auto max-w-[1240px]">
            <div className="mb-1 text-[12px] text-[#92a0b2]">Home / Dashboard</div>
            <div id="hospital-overview" className="mb-5 flex flex-wrap items-center justify-between gap-3 scroll-mt-24"><div><h2 className="text-[1.95rem] font-semibold text-[#2d4a73]">Vaccination Center Dashboard</h2><p className="mt-1 text-sm text-slate-500">{hospitalIdentity || "Organization is assigned from your signed-in account."}</p></div><button type="button" onClick={refreshPage} disabled={loading || Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-50"><RefreshCw size={16} />{loading ? "Refreshing..." : "Refresh dashboard"}</button></div>
            {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}

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
                      <StatusBadge value={workflowStatus(latest)} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <form id="hospital-orders" onSubmit={submitOrder} noValidate className="scroll-mt-24 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Hospital Vaccine Order</h4>
                <p className="mb-4 text-sm text-slate-500">
                  Submit a vaccine order for admin review. Admin decisions will notify the hospital, and distributors only see approved orders.
                </p>
                {formErrors.order && <p role="alert" className="mb-3 text-sm text-rose-700">{formErrors.order}</p>}
                <fieldset disabled={Boolean(busy)} className="grid grid-cols-1 gap-3 md:grid-cols-2 disabled:opacity-60">
                  <label className="text-sm">Hospital<input className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" value={hospitalIdentity || "Signed-in hospital"} readOnly /></label>
                  <label className="text-sm">Region<input required maxLength={150} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={orderForm.region} onChange={(e) => setOrderForm({ ...orderForm, region: e.target.value })} /></label>
                  <label className="text-sm">Vaccine type<input required maxLength={200} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={orderForm.vaccineType} onChange={(e) => setOrderForm({ ...orderForm, vaccineType: e.target.value })} /></label>
                  <label className="text-sm">Requested doses<input required min="1" step="1" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={orderForm.requestedDoses} onChange={(e) => setOrderForm({ ...orderForm, requestedDoses: e.target.value })} /></label>
                  <label className="text-sm">Priority<select className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={orderForm.priority} onChange={(e) => setOrderForm({ ...orderForm, priority: e.target.value })}>
                    <option>High</option>
                    <option>Normal</option>
                    <option>Low</option>
                  </select></label>
                  <label className="text-sm md:col-span-2">Order notes (optional)<textarea maxLength={2000} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" rows={3} value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} /></label>
                </fieldset>
                <button type="submit" disabled={Boolean(busy) || loading || uncertainOperation === "order"} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
                  {busy === "order" ? "Submitting..." : "Submit Vaccine Order"}
                </button>
              </form>

              <form id="hospital-vaccinate" onSubmit={runWorkflow} noValidate className="scroll-mt-24 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <h4 className="mb-3 font-semibold text-slate-800">Record Vaccination &amp; Report</h4>
                <p className="mb-4 text-sm text-slate-500">Use synthetic patient references only. Confirm a distributor delivery first; available doses are checked again by the server. No stock is added by this form.</p>
                {formErrors.workflow && <p role="alert" className="mb-3 text-sm text-rose-700">{formErrors.workflow}</p>}
                <fieldset disabled={Boolean(busy)} className="grid grid-cols-1 gap-3 md:grid-cols-2 disabled:opacity-60">
                  <label className="text-sm md:col-span-2">Confirmed batch<select required className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.batchId} onChange={event => setForm(current => ({ ...current, batchId: event.target.value }))}><option value="">Select a received batch</option>{confirmedBatches.map(batch => <option key={batch.batchId} value={batch.batchId}>{batch.batchId} — {batch.vaccineType} ({batch.available} available)</option>)}</select></label>
                  <label className="text-sm">Synthetic patient/reference<input required maxLength={200} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} /></label>
                  <label className="text-sm">Doses used<input required min="1" max={selectedBatch?.available || 0} step="1" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={form.dosesUsed} onChange={(e) => setForm({ ...form, dosesUsed: e.target.value })} /></label>
                  <label className="text-sm">Reporting authority<input required maxLength={200} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.healthAuthority} onChange={event => setForm(current => ({ ...current, healthAuthority: event.target.value }))} /></label>
                  <label className="text-sm">Notes (optional)<textarea maxLength={2000} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></label>
                </fieldset>
                <button type="submit" disabled={Boolean(busy) || loading || !confirmedBatches.length || uncertainOperation === "vaccinate"} className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">
                  {busy === "vaccinate" ? "Saving workflow..." : "Record vaccination and report"}
                </button>
              </form>

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
                        <StatusBadge value={order.status} />
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

              <div id="hospital-notifications" className="scroll-mt-24 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
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

            <div id="hospital-feedback" className="mb-5 scroll-mt-24">
              <FeedbackForm
                healthcareCenter={hospitalIdentity}
                region={orderForm.region}
                submittedBy={submittedByContext}
                batchSuggestions={feedbackBatchSuggestions}
                appointments={appointments}
              />
            </div>

            <BatchVerificationPanel />

            <div id="hospital-deliveries" className="scroll-mt-24 mb-5 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
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
                      <StatusBadge value={shipment.coldChainStatus || shipment.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Delivery confirmation note"
                        aria-label={`Confirmation note for ${shipment.shipmentId}`}
                        maxLength={2000}
                        value={deliveryNotes[shipment.shipmentId] || ""}
                        onChange={(e) =>
                          setDeliveryNotes((current) => ({
                            ...current,
                            [shipment.shipmentId]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={Boolean(busy) || loading || /quarantin/i.test(shipment.coldChainStatus || "") || !/supplied|delivered/i.test(shipment.status || "")}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
                        onClick={() => confirmDelivery(shipment)}
                      >
                        {busy === shipment.shipmentId ? "Confirming..." : "Confirm Received"}
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

            <div id="hospital-reports" className="scroll-mt-24 rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold text-slate-800">Workflow Logs</h4><button type="button" onClick={exportReports} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><Download size={15} />Export workflow</button></div>
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
                          {workflowStatus(r)}
                        </td>
                        <td className="py-2">{new Date(r.date).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div id="hospital-shipment-monitor" className="mt-5 scroll-mt-24"><LiveShipmentVisualizer compact maxVisible={3} title="Healthcare shipment and sensor history" /></div>
            <div id="hospital-alerts" className="scroll-mt-24"><TemperatureAlertPanel role="healthcare" /></div>
            <div id="shipment-journey"><TraceabilityPanel /></div>
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
