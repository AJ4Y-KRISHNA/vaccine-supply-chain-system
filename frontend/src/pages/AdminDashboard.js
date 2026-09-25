import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Doughnut, Line } from "react-chartjs-2";
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import {
  AlertTriangle,
  CheckCircle2,
  Bell,
  Brain,
  Database,
  Home,
  Link2,
  LogOut,
  MapPinned,
  MessageSquareText,
  Package2,
  RefreshCw,
  Search,
  Shield,
  Thermometer,
  Truck,
  UserCircle2,
  Users,
} from "lucide-react";
import BlockchainLog from "../components/BlockchainLog";
import { useToast } from "../components/Toast";
import SentimentFeedbackPanel from "../components/Admin/SentimentFeedbackPanel";
import TemperatureAlertPanel from "../components/TemperatureAlertPanel";
import SimulatorPanel from "../components/SimulatorPanel";
import SupplyPlannerPanel from "../components/Admin/SupplyPlannerPanel";
import OrderAllocationFields from "../components/Admin/OrderAllocationFields";
import {
  fetchAdminMonitoring,
  fetchAdminOrders,
  fetchAdminReports,
  fetchAdminUsers,
  fetchAdminWorkflow,
  reviewAdminOrder,
  runAdminSentiment,
} from "../services/workflow";

import BatchDispositionBadge from "../components/BatchDispositionBadge";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend);

const EMPTY_MONITORING = {
  summary: { batches: 0, shipments: 0, blockchainLogs: 0, tempAlerts: 0 },
  batches: [],
  shipments: [],
  distributions: [],
  temperatureLogs: [],
  vaccinations: [],
  adminActions: [],
};

const EMPTY_REPORTS = {
  forecast: { predicted_demand: 0 },
  insights: [],
  reportSeries: [],
  summary: { totalInsights: 0, predictedDemand: 0, highRiskCount: 0 },
};

function shortHash(value) {
  if (!value) return "--";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function formatRole(value) {
  const role = String(value || "").toLowerCase();
  if (role === "admin") return "Admin";
  if (role === "manufacturer") return "Manufacturer";
  if (role === "distributor") return "Distributor";
  if (role === "healthcare") return "Healthcare";
  return value || "Unknown";
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

function goTo(sectionId) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function canFocusBatch(batchId) {
  return Boolean(batchId && batchId !== "--");
}

function isActiveBatch(batchId, selectedBatchId) {
  return canFocusBatch(batchId) && batchId === selectedBatchId;
}

function getStatusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("alert") || value.includes("high") || value.includes("critical")) {
    return "bg-[#fff0f0] text-[#d85a5a]";
  }
  if (
    value.includes("active") ||
    value.includes("verified") ||
    value.includes("delivered") ||
    value.includes("supplied") ||
    value.includes("stable") ||
    value.includes("normal")
  ) {
    return "bg-[#e8f7ef] text-[#2ea67f]";
  }
  if (value.includes("pending") || value.includes("transit") || value.includes("monitor")) {
    return "bg-[#fff7e8] text-[#c97d2c]";
  }
  return "bg-[#eef5ff] text-[#3278d7]";
}

function MetricCard({ icon: Icon, label, value, accent, badge }) {
  return (
    <div className="rounded-[14px] border border-[#e6eef8] bg-white px-4 py-4 shadow-sm">
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${badge}`}>
        <Icon size={22} />
      </div>
      <p className="mt-4 text-[13px] text-[#7a8a9d]">{label}</p>
      <div className={`mt-1 text-[2rem] font-bold ${accent}`}>{value}</div>
    </div>
  );
}

function PanelHeader({ title, description, loading, onRefresh }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[1.05rem] font-semibold text-[#42566f]">{title}</h3>
        {description ? <p className="mt-1 text-xs text-[#8aa0ba]">{description}</p> : null}
      </div>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#dbe6f2] px-3 py-1.5 text-xs font-semibold text-[#4b6b90] hover:bg-[#f4f8fd] disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      ) : null}
    </div>
  );
}

const AdminDashboard = () => {
  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [monitoring, setMonitoring] = useState(EMPTY_MONITORING);
  const [reports, setReports] = useState(EMPTY_REPORTS);
  const [workflow, setWorkflow] = useState([]);
  const [sentiment, setSentiment] = useState({ sentiment: { sentiment: "Neutral", score: 0 } });
  const [sentimentText, setSentimentText] = useState("Public discussion around vaccine supply remains stable.");
  const [userSearch, setUserSearch] = useState("");
  const [monitorView, setMonitorView] = useState("shipments");
  const [alertFilter, setAlertFilter] = useState("all");
  const [selectedAuditBatchId, setSelectedAuditBatchId] = useState("");
  const [adminOrders, setAdminOrders] = useState([]);
  const [decisionNotes, setDecisionNotes] = useState({});
  const [allocations, setAllocations] = useState({});
  const [allocationOptions, setAllocationOptions] = useState([]);
  const [distributorOptions, setDistributorOptions] = useState([]);
  const [reviewingOrder, setReviewingOrder] = useState("");
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingSentiment, setLoadingSentiment] = useState(false);
  const [loading, setLoading] = useState({ users: false, monitoring: false, reports: false, workflow: false, orders: false });
  const { addToast } = useToast();

  const setLoadingKey = (key, value) => setLoading((prev) => ({ ...prev, [key]: value }));

  const loadUsers = async (silent = false) => {
    try {
      setLoadingKey("users", true);
      const response = await fetchAdminUsers();
      const nextUsers = Array.isArray(response) ? response : response?.users || [];
      setUsers(nextUsers);
      setUserTotal(response?.total || nextUsers.length);
    } catch (_error) {
      setUsers([]);
      setUserTotal(0);
      if (!silent) addToast("error", "User management data failed to load");
    } finally {
      setLoadingKey("users", false);
    }
  };

  const loadMonitoring = async (silent = false) => {
    try {
      setLoadingKey("monitoring", true);
      setMonitoring((await fetchAdminMonitoring()) || EMPTY_MONITORING);
    } catch (_error) {
      setMonitoring(EMPTY_MONITORING);
      if (!silent) addToast("error", "Monitoring data failed to load");
    } finally {
      setLoadingKey("monitoring", false);
    }
  };

  const loadReports = async (silent = false) => {
    try {
      setLoadingKey("reports", true);
      setReports((await fetchAdminReports()) || EMPTY_REPORTS);
    } catch (_error) {
      setReports(EMPTY_REPORTS);
      if (!silent) addToast("error", "Reports data failed to load");
    } finally {
      setLoadingKey("reports", false);
    }
  };

  const loadWorkflow = async (silent = false) => {
    try {
      setLoadingKey("workflow", true);
      const response = await fetchAdminWorkflow();
      setWorkflow(response?.workflow || []);
    } catch (_error) {
      setWorkflow([]);
      if (!silent) addToast("error", "Workflow data failed to load");
    } finally {
      setLoadingKey("workflow", false);
    }
  };

  const loadOrders = async (silent = false) => {
    try {
      setLoadingKey("orders", true);
      const response = await fetchAdminOrders();
      setAdminOrders(response?.orders || []);
      setAllocationOptions(response?.allocationOptions || []);
      setDistributorOptions(response?.distributors || []);
    } catch (_error) {
      setAdminOrders([]);
      setAllocationOptions([]);
      setDistributorOptions([]);
      if (!silent) addToast("error", "Order queue failed to load");
    } finally {
      setLoadingKey("orders", false);
    }
  };

  const loadPage = async () => {
    setLoadingPage(true);
    await Promise.allSettled([loadUsers(true), loadMonitoring(true), loadReports(true), loadWorkflow(true), loadOrders(true)]);
    setLoadingPage(false);
  };

  useEffect(() => {
    loadPage();
    // load once on page mount; section refresh buttons handle subsequent updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSentiment = async () => {
    try {
      setLoadingSentiment(true);
      const result = await runAdminSentiment(sentimentText);
      setSentiment(result || { sentiment: { sentiment: "Neutral", score: 0 } });
      addToast("success", "Sentiment analysis updated");
      await Promise.allSettled([loadMonitoring(true), loadReports(true), loadWorkflow(true)]);
    } catch (_error) {
      addToast("error", "Sentiment analysis failed");
    } finally {
      setLoadingSentiment(false);
    }
  };

  const reviewOrderDecision = async (orderId, decision) => {
    try {
      setReviewingOrder(orderId);
      await reviewAdminOrder(orderId, {
        decision,
        note: decisionNotes[orderId] || "",
        ...(allocations[orderId] || {}),
      });
      addToast("success", `Order ${decision.toLowerCase()}d successfully`);
      await Promise.allSettled([loadOrders(true), loadMonitoring(true), loadReports(true), loadWorkflow(true)]);
    } catch (error) {
      addToast("error", error.response?.data?.error || `Unable to ${decision.toLowerCase()} order`);
    } finally {
      setReviewingOrder("");
    }
  };

  const summary = monitoring?.summary || EMPTY_MONITORING.summary;
  const alerts = useMemo(
    () =>
      (monitoring?.temperatureLogs || [])
        .filter((item) => item.status === "Alert")
        .slice(0, 4)
        .map((item) => ({
          title: `Temperature alert for ${item.batchId}`,
          time: formatDateTime(item.recordedAt),
        })),
    [monitoring]
  );

  const alertRows = useMemo(() => {
    const logs = (monitoring?.temperatureLogs || []).map((item) => ({
      id: item._id,
      batchId: item.batchId || "--",
      status: item.status || "Unknown",
      reading: item.temperature != null ? `${item.temperature} deg C` : "--",
      time: formatDateTime(item.recordedAt),
    }));

    if (alertFilter === "alerts") {
      return logs.filter((item) => String(item.status).toLowerCase() === "alert");
    }
    if (alertFilter === "stable") {
      return logs.filter((item) => String(item.status).toLowerCase() !== "alert");
    }
    return logs;
  }, [alertFilter, monitoring]);

  const monitoringTabs = useMemo(
    () => ({
      batches: {
        label: "Batches",
        rows: (monitoring?.batches || []).map((item) => ({
          id: item._id || item.batchId,
          title: item.batchId || "--",
          subtitle: item.vaccineType || "Vaccine batch",
          status: item.coldChainStatus || item.status || "Created",
          disposition: item.disposition,
          meta: formatDateTime(item.createdAt),
          txHash: item.txHash,
        })),
      },
      shipments: {
        label: "Shipments",
        rows: (monitoring?.shipments || []).map((item) => ({
          id: item._id || item.batchId,
          title: item.batchId || "--",
          subtitle: item.destination || item.currentLocation || "Shipment route",
          status: item.coldChainStatus || item.status || "Pending",
          meta: formatDateTime(item.lastUpdatedAt || item.createdAt),
          txHash: item.txHash,
        })),
      },
      distributions: {
        label: "Distribution",
        rows: (monitoring?.distributions || []).map((item) => ({
          id: item._id || item.batchId,
          title: item.batchId || "--",
          subtitle: item.targetCenter || "Distribution center",
          status: item.decision || item.blockchainStatus || "Pending",
          meta: formatDateTime(item.timestamp),
          txHash: item.txHash,
        })),
      },
      vaccinations: {
        label: "Vaccinations",
        rows: (monitoring?.vaccinations || []).map((item) => ({
          id: item._id || item.batchId,
          title: item.batchId || "--",
          subtitle: item.centerName || item.vaccineType || "Vaccination record",
          status: item.reportStatus || item.status || "Recorded",
          meta: formatDateTime(item.date || item.createdAt),
          txHash: item.txHash,
        })),
      },
    }),
    [monitoring]
  );

  const activeMonitoring = monitoringTabs[monitorView] || monitoringTabs.shipments;

  const blockchainRecords = useMemo(() => {
    const groups = [
      ...(monitoring?.batches || []).map((item) => ({
        blockHash: item.txHash,
        batchId: item.batchId,
        type: item.vaccineType || "Batch",
        timestamp: item.createdAt,
      })),
      ...(monitoring?.shipments || []).map((item) => ({
        blockHash: item.txHash,
        batchId: item.batchId,
        type: item.status || "Shipment",
        timestamp: item.lastUpdatedAt || item.createdAt,
      })),
      ...(monitoring?.distributions || []).map((item) => ({
        blockHash: item.txHash,
        batchId: item.batchId,
        type: item.decision || "Distribution",
        timestamp: item.timestamp,
      })),
    ];
    return groups.filter((item) => item.blockHash).slice(0, 8);
  }, [monitoring]);

  const userRows = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users
      .filter((user) => {
        if (!query) return true;
        return (
          String(user.email || "").toLowerCase().includes(query) ||
          String(user.role || "").toLowerCase().includes(query)
        );
      })
      .map((user) => ({
        id: user._id,
        email: user.email,
        role: formatRole(user.role),
        status: user.status || "Active",
        lastActivityAt: user.lastActivityAt,
      }));
  }, [userSearch, users]);

  const reportSeries = (reports?.reportSeries || []).length
    ? reports.reportSeries.slice(-6)
    : (reports?.insights || []).slice(0, 5).map((item, index) => ({
        label: item.batchId || `Insight ${index + 1}`,
        value: Number(item.forecastDemand || 0),
      }));

  const forecastData = {
    labels: reportSeries.length ? reportSeries.map((item) => item.label) : ["Forecast"],
    datasets: [
      {
        label: "Demand Forecast",
        data: reportSeries.length ? reportSeries.map((item) => Number(item.value || 0)) : [Number(reports?.forecast?.predicted_demand || 0)],
        borderColor: "#5d9bf0",
        backgroundColor: "rgba(93, 155, 240, 0.15)",
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: "#5d9bf0",
      },
    ],
  };

  const currentLabel = sentiment?.sentiment?.sentiment || "Neutral";
  const currentScore = Number(sentiment?.sentiment?.score || 0);
  const sentimentData = {
    labels: ["Positive", "Neutral", "Negative"],
    datasets: [
      {
        data: [
          String(currentLabel).toLowerCase().includes("positive") ? 1 : 0,
          String(currentLabel).toLowerCase().includes("neutral") ? 1 : 0,
          String(currentLabel).toLowerCase().includes("negative") ? 1 : 0,
        ],
        backgroundColor: ["#39bf93", "#f2bc52", "#f06c7c"],
        borderWidth: 0,
      },
    ],
  };

  const auditBatchIds = useMemo(() => {
    const ids = [
      ...adminOrders.map((item) => item.auditBatchId),
      ...(monitoring?.batches || []).map((item) => item.batchId),
      ...(monitoring?.shipments || []).map((item) => item.batchId),
      ...(monitoring?.distributions || []).map((item) => item.batchId),
      ...(monitoring?.vaccinations || []).map((item) => item.batchId),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [adminOrders, monitoring]);

  useEffect(() => {
    if (!auditBatchIds.length) {
      setSelectedAuditBatchId("");
      return;
    }

    if (!selectedAuditBatchId || !auditBatchIds.includes(selectedAuditBatchId)) {
      setSelectedAuditBatchId(auditBatchIds[0]);
    }
  }, [auditBatchIds, selectedAuditBatchId]);

  const focusAuditBatch = (batchId) => {
    if (!batchId) return;
    setSelectedAuditBatchId(batchId);
    document.getElementById("admin-blockchain-audit")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70" size={16} />
              <input
                className="w-60 rounded-full border border-white/20 bg-white/12 py-2 pl-9 pr-4 text-sm text-white placeholder-white/60 outline-none"
                placeholder="Search admin data..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>
            <div className="relative">
              <Bell size={18} />
              <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#ff6d6d] text-[10px]">{alerts.length}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>Admin</span>
              <UserCircle2 size={24} />
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="min-h-[calc(100vh-64px)] w-[120px] bg-gradient-to-b from-[#124e97] to-[#206eb9] text-white shadow-xl">
          <nav className="space-y-2 px-3 pt-6 text-[13px]">
            <button type="button" onClick={() => goTo("admin-top")} className="flex w-full items-center gap-2 rounded-lg bg-white/12 px-3 py-3 text-left">
              <Home size={15} />
              <span>Dashboard</span>
            </button>
            <button type="button" onClick={() => goTo("admin-users")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10">
              <Users size={15} />
              <span>User Mgmt</span>
            </button>
            <button type="button" onClick={() => goTo("admin-monitoring")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10">
              <Database size={15} />
              <span>Monitoring</span>
            </button>
            <button type="button" onClick={() => goTo("admin-reports")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10">
              <Brain size={15} />
              <span>Reports</span>
            </button>
            <button type="button" onClick={() => goTo("admin-feedback")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10">
              <MessageSquareText size={15} />
              <span>Sent/Feedback</span>
            </button>
            <button type="button" onClick={() => goTo("admin-sentiment")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10">
              <MessageSquareText size={15} />
              <span>Sentiment</span>
            </button>
            <Link to="/" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <LogOut size={15} />
              <span>Logout</span>
            </Link>
          </nav>
        </aside>

        <main className="flex-1 px-5 py-5">
          <div className="mx-auto max-w-[1240px]" id="admin-top">
            <div className="mb-1 text-[12px] text-[#92a0b2]">Home / Dashboard</div>
            <h2 className="mb-5 text-[1.95rem] font-semibold text-[#2d4a73]">Admin Dashboard</h2>
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Package2} label="Batches" value={summary.batches} accent="text-[#2b68c6]" badge="bg-[#e8f1ff] text-[#2f7fd4]" />
              <MetricCard icon={Truck} label="Shipments" value={summary.shipments} accent="text-[#2ea67f]" badge="bg-[#e8fbf3] text-[#2ea67f]" />
              <MetricCard icon={Link2} label="Blockchain Logs" value={summary.blockchainLogs} accent="text-[#d08337]" badge="bg-[#fff1df] text-[#d08337]" />
              <MetricCard icon={Thermometer} label="Temp Alerts" value={summary.tempAlerts} accent="text-[#de6666]" badge="bg-[#fff0f0] text-[#de6666]" />
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr_0.8fr]" id="admin-monitoring">
              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <PanelHeader title="Admin Workflow" description="Live DFD step completion for the admin module." loading={loading.workflow} onRefresh={() => loadWorkflow()} />
                <div className="space-y-3">
                  {workflow.map((step, index) => (
                    <div key={index} className="flex items-center justify-between rounded-xl border border-[#edf2f8] px-3 py-3">
                      <span className="text-sm text-[#42566f]">{step.step}</span>
                      <span className="rounded-md bg-[#eef5ff] px-2.5 py-1 text-[11px] font-semibold text-[#3278d7]">{step.status}</span>
                    </div>
                  ))}
                  {!workflow.length && (
                    <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#a1b0c1]">
                      {loading.workflow || loadingPage ? "Loading workflow..." : "No admin workflow data available yet."}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
                <PanelHeader
                  title="Monitoring Console"
                  description="Switch across live operational feeds for each supply-chain stage."
                  loading={loading.monitoring}
                  onRefresh={() => loadMonitoring()}
                />
                <div className="mb-4 flex flex-wrap gap-2">
                  {Object.entries(monitoringTabs).map(([key, config]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMonitorView(key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        monitorView === key
                          ? "bg-[#2f8ae0] text-white"
                          : "border border-[#dbe6f2] bg-[#f8fbff] text-[#59799d] hover:bg-[#eef5ff]"
                      }`}
                    >
                      {config.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {activeMonitoring?.rows?.slice(0, 6).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => focusAuditBatch(row.title)}
                      className={`block w-full rounded-xl border px-3 py-3 text-left transition ${
                        isActiveBatch(row.title, selectedAuditBatchId)
                          ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                          : "border-[#edf2f8] hover:border-[#9ec6f3] hover:bg-[#f8fbff]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#42566f]">{row.title}</div>
                          <div className="mt-1 text-xs text-[#8192a7]">{row.subtitle}</div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${getStatusTone(row.status)}`}>
                            {row.status}
                          </span>
                          {monitorView === "batches" ? <BatchDispositionBadge disposition={row.disposition} /> : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#60748f]">
                        <span>{row.meta}</span>
                        <span className="font-mono">{shortHash(row.txHash)}</span>
                        <span className={`font-semibold ${isActiveBatch(row.title, selectedAuditBatchId) ? "text-[#1f6fd1]" : "text-[#2f8ae0]"}`}>
                          {isActiveBatch(row.title, selectedAuditBatchId) ? "Active in audit" : "Open audit"}
                        </span>
                      </div>
                    </button>
                  ))}
                  {!activeMonitoring?.rows?.length && (
                    <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#a1b0c1]">
                      {loading.monitoring || loadingPage
                        ? "Loading monitoring feed..."
                        : `No ${activeMonitoring?.label?.toLowerCase() || "monitoring"} records available yet.`}
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-xl bg-[#f8fbff] px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#42566f]">
                    <Database size={15} />
                    Latest blockchain records
                  </div>
                  <div className="space-y-2">
                    {blockchainRecords.slice(0, 3).map((record, index) => (
                      <button
                        key={`${record.batchId}-mini-${index}`}
                        type="button"
                        onClick={() => canFocusBatch(record.batchId) && focusAuditBatch(record.batchId)}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-[12px] text-[#60748f] transition ${
                          isActiveBatch(record.batchId, selectedAuditBatchId)
                            ? "bg-[#eaf4ff] text-[#2f5f96]"
                            : "hover:bg-[#eef5ff]"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{record.batchId}</span>
                          {canFocusBatch(record.batchId) ? (
                            <span className="font-semibold text-[#2f8ae0]">
                              {isActiveBatch(record.batchId, selectedAuditBatchId) ? "Active in audit" : "Open audit"}
                            </span>
                          ) : null}
                        </span>
                        <span className="font-mono">{shortHash(record.blockHash)}</span>
                      </button>
                    ))}
                    {!blockchainRecords.length && <div className="text-[12px] text-[#9cacbf]">No chain records yet.</div>}
                  </div>
                </div>
              </div>

              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <PanelHeader
                  title="Alerts"
                  description="Filter live temperature events and inspect recent exceptions."
                  loading={loading.monitoring}
                  onRefresh={() => loadMonitoring()}
                />
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#fff5f5] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#d18a8a]">Active Alerts</div>
                    <div className="mt-1 flex items-center gap-2 text-xl font-bold text-[#d85a5a]">
                      <AlertTriangle size={18} />
                      {summary.tempAlerts}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#f4fbf7] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#7fb294]">Stable Logs</div>
                    <div className="mt-1 flex items-center gap-2 text-xl font-bold text-[#2ea67f]">
                      <CheckCircle2 size={18} />
                      {Math.max((monitoring?.temperatureLogs || []).length - summary.tempAlerts, 0)}
                    </div>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  {[
                    { key: "all", label: "All Logs" },
                    { key: "alerts", label: "Only Alerts" },
                    { key: "stable", label: "Stable" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setAlertFilter(item.key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        alertFilter === item.key
                          ? "bg-[#2f8ae0] text-white"
                          : "border border-[#dbe6f2] bg-[#f8fbff] text-[#59799d] hover:bg-[#eef5ff]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {alertRows.slice(0, 6).map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => canFocusBatch(alert.batchId) && focusAuditBatch(alert.batchId)}
                      className={`block w-full rounded-xl border border-[#edf2f8] px-3 py-3 text-left transition ${
                        isActiveBatch(alert.batchId, selectedAuditBatchId)
                          ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                          : canFocusBatch(alert.batchId)
                            ? "hover:border-[#9ec6f3] hover:bg-[#f8fbff]"
                            : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 font-semibold text-[#42566f]">
                            <span>{alert.batchId}</span>
                            {canFocusBatch(alert.batchId) ? (
                              <span className="text-[11px] font-semibold text-[#2f8ae0]">
                                {isActiveBatch(alert.batchId, selectedAuditBatchId) ? "Active in audit" : "Open audit"}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-[#8192a7]">{alert.time}</div>
                        </div>
                        <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${getStatusTone(alert.status)}`}>
                          {alert.status}
                        </span>
                      </div>
                      <div className="mt-2 text-[12px] text-[#60748f]">Reading: {alert.reading}</div>
                    </button>
                  ))}
                  {!alertRows.length && (
                    <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#a1b0c1]">
                      {loading.monitoring || loadingPage ? "Checking alerts..." : "No logs available for the selected filter."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-4 rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
              <PanelHeader
                title="Hospital Vaccine Orders"
                description="Allocate an existing released batch and mapped distributor. Forecast and sentiment are advisory only."
                loading={loading.orders}
                onRefresh={() => loadOrders()}
              />
              <div className="space-y-3">
                {adminOrders.map((order) => (
                  <div
                    key={order._id}
                    className={`rounded-xl border px-4 py-4 ${
                      isActiveBatch(order.allocatedBatchId || order.auditBatchId, selectedAuditBatchId)
                        ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                        : "border-[#edf2f8] bg-white"
                    }`}
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => focusAuditBatch(order.allocatedBatchId || order.auditBatchId)}
                            className="font-semibold text-[#42566f] hover:text-[#2f8ae0]"
                          >
                            {order.orderId}
                          </button>
                          <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${getStatusTone(order.status)}`}>
                            {order.status}
                          </span>
                          <span className="rounded-md bg-[#f6f1ff] px-2.5 py-1 text-[11px] font-semibold text-[#8a58df]">
                            Risk {order.riskFlag}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#60748f]">
                          <span>Hospital: {order.hospital}</span>
                          <span>Region: {order.region}</span>
                          <span>Vaccine: {order.vaccineType}</span>
                          <span>Doses: {order.requestedDoses}</span>
                          <span>Forecast: {Number(order.forecastDemand || 0).toLocaleString()}</span>
                          <span>Sentiment: {Number(order.sentimentScore || 0).toFixed(2)} ({order.sentimentLabel})</span>
                        </div>
                        {order.notes ? (
                          <div className="mt-3 rounded-lg bg-[#f8fbff] px-3 py-2 text-sm text-[#60748f]">
                            Hospital Note: {order.notes}
                          </div>
                        ) : null}
                      </div>
                      <div className="w-full max-w-[360px] space-y-2">
                        <OrderAllocationFields order={order} options={allocationOptions} distributors={distributorOptions}
                          value={allocations[order.orderId] || { batchId: order.allocatedBatchId, distributor: order.distributor }}
                          onChange={value => setAllocations(prev => ({ ...prev, [order.orderId]: value }))} />
                        <textarea
                          rows={2}
                          value={decisionNotes[order.orderId] || ""}
                          onChange={(e) =>
                            setDecisionNotes((prev) => ({ ...prev, [order.orderId]: e.target.value }))
                          }
                          placeholder="Add decision note for hospital"
                          className="w-full rounded-xl border border-[#dfe7f1] px-3 py-2 text-sm outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => reviewOrderDecision(order.orderId, "Approve")}
                            disabled={order.status !== "Pending" || Boolean(reviewingOrder) || !allocations[order.orderId]?.batchId || !allocations[order.orderId]?.distributor}
                            className="flex-1 rounded-xl bg-[#2ea67f] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => reviewOrderDecision(order.orderId, "Decline")}
                            disabled={order.status !== "Pending" || Boolean(reviewingOrder)}
                            className="flex-1 rounded-xl bg-[#e56b6b] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                        {order.approvalTxHash ? (
                          <div className="font-mono text-[11px] text-[#8aa0ba]">
                            Approval Tx: {shortHash(order.approvalTxHash)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
                {!adminOrders.length && (
                  <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#a1b0c1]">
                    {loading.orders || loadingPage ? "Loading hospital orders..." : "No hospital orders pending admin review."}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_0.95fr]">
              <div id="admin-users" className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
                <PanelHeader title="User Management" description={`Manage ${userTotal} registered platform users.`} loading={loading.users} onRefresh={() => loadUsers()} />
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search user or role"
                    className="w-full rounded-xl border border-[#dfe7f1] px-3 py-2.5 text-sm outline-none"
                  />
                  <div className="rounded-xl bg-[#f5f9ff] px-4 py-2.5 text-sm font-semibold text-[#4a6f99]">Active Users: {userTotal}</div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="border-b border-[#edf2f8] text-left text-[#7d8ca0]">
                      <tr>
                        <th className="py-2">Email</th>
                        <th className="py-2">Role</th>
                        <th className="py-2">Status</th>
                        <th className="py-2">Last Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userRows.map((user) => (
                        <tr key={user.id} className="border-b border-[#f4f7fb] text-[#53657b]">
                          <td className="py-2.5 font-medium">{user.email}</td>
                          <td className="py-2.5">{user.role}</td>
                          <td className="py-2.5">
                            <span className="rounded-md bg-[#e8f7ef] px-2.5 py-1 text-[11px] font-semibold text-[#2ea67f]">{user.status}</span>
                          </td>
                          <td className="py-2.5 text-[#7f91a7]">{formatDateTime(user.lastActivityAt)}</td>
                        </tr>
                      ))}
                      {!userRows.length && (
                        <tr>
                          <td colSpan="4" className="py-8 text-center text-[#9cacbf]">
                            {loading.users || loadingPage ? "Loading users..." : "No users matched your search."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div id="admin-reports" className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
                <PanelHeader title="Reports & Insights" description="AI forecast trends and recent distribution decisions." loading={loading.reports} onRefresh={() => loadReports()} />
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-[#f7fbff] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#8aa0ba]">Predicted</div>
                    <div className="mt-1 text-xl font-bold text-[#2d4a73]">{Number(reports?.summary?.predictedDemand || reports?.forecast?.predicted_demand || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-[#f7fff9] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#8bb59e]">Insights</div>
                    <div className="mt-1 text-xl font-bold text-[#27855f]">{reports?.summary?.totalInsights || 0}</div>
                  </div>
                  <div className="rounded-xl bg-[#fff8f0] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#c19767]">High Risk</div>
                    <div className="mt-1 text-xl font-bold text-[#c97d2c]">{reports?.summary?.highRiskCount || 0}</div>
                  </div>
                </div>
                <div className="h-[220px]">
                  <Line
                    data={forecastData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { ticks: { color: "#7d8ca0", maxRotation: 0, minRotation: 0 } },
                        y: { beginAtZero: true, ticks: { color: "#7d8ca0" } },
                      },
                    }}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {(reports?.insights || []).map((item, index) => (
                    <button
                      key={`${item.batchId}-${index}`}
                      type="button"
                      onClick={() => canFocusBatch(item.batchId) && focusAuditBatch(item.batchId)}
                      className={`block w-full rounded-xl border border-[#edf2f8] px-3 py-2.5 text-left text-sm transition ${
                        isActiveBatch(item.batchId, selectedAuditBatchId)
                          ? "border-[#2f8ae0] bg-[#eef6ff] ring-1 ring-[#bfdbfe]"
                          : canFocusBatch(item.batchId)
                            ? "hover:border-[#9ec6f3] hover:bg-[#f8fbff]"
                            : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 font-semibold text-[#42566f]">
                          <span>{item.batchId}</span>
                          {canFocusBatch(item.batchId) ? (
                            <span className="text-[11px] font-semibold text-[#2f8ae0]">
                              {isActiveBatch(item.batchId, selectedAuditBatchId) ? "Active in audit" : "Open audit"}
                            </span>
                          ) : null}
                        </span>
                        <span className="rounded-md bg-[#eef5ff] px-2 py-1 text-[11px] font-semibold text-[#3278d7]">{item.decision || "Pending"}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#60748f]">
                        <span>Forecast: {Number(item.forecastDemand || 0).toLocaleString()}</span>
                        <span>Sentiment: {Number(item.sentimentScore || 0).toFixed(2)}</span>
                        <span>Center: {item.targetCenter || "National Warehouse"}</span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-[#9aabbe]">{shortHash(item.txHash)}</div>
                    </button>
                  ))}
                  {!(reports?.insights || []).length && (
                    <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#a1b0c1]">
                      {loading.reports || loadingPage ? "Loading report insights..." : "No report insights available yet."}
                    </div>
                  )}
                </div>
              </div>

              <div id="admin-sentiment" className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
                <PanelHeader title="Sentiment Analysis" description="Run multilingual sentiment analysis and log it on-chain." loading={loadingSentiment} />
                <textarea className="mb-3 w-full rounded-xl border border-[#dfe7f1] px-3 py-2.5 text-sm" rows={4} value={sentimentText} onChange={(e) => setSentimentText(e.target.value)} />
                <button onClick={runSentiment} disabled={loadingSentiment} className="mb-4 w-full rounded-xl bg-[#2f8ae0] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                  {loadingSentiment ? "Analyzing..." : "Run Sentiment Analysis"}
                </button>
                <div className="grid grid-cols-[0.9fr_1.1fr] items-center gap-4">
                  <div className="h-[160px]">
                    <Doughnut data={sentimentData} options={{ plugins: { legend: { display: false } } }} />
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[#42566f]">Current Label</span>
                      <span className="rounded-md bg-[#eef5ff] px-2.5 py-1 text-[11px] font-semibold text-[#3278d7]">{currentLabel}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#42566f]">Score</span>
                      <span className="font-semibold text-[#2d4a73]">{currentScore.toFixed(2)}</span>
                    </div>
                    <div className="relative h-24 overflow-hidden rounded-xl border border-[#e5eef8] bg-[linear-gradient(135deg,#d8ecff,#f6fbff)]">
                      <div className="absolute left-5 top-7 h-9 w-14 rounded-[55%] bg-[#c2ddff]" />
                      <div className="absolute right-7 top-8 h-9 w-16 rounded-[55%] bg-[#bfdcff]" />
                      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 text-[11px] text-[#7b8da1]">
                        <MapPinned size={12} />
                        Sentiment reports
                      </div>
                    </div>
                    {sentiment?.txHash ? <div className="rounded-lg bg-[#f7fbff] px-3 py-2 font-mono text-[11px] text-[#7d90a6]">Tx: {shortHash(sentiment.txHash)}</div> : null}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {(monitoring?.adminActions || []).map((item) => (
                    <div key={item._id} className="rounded-xl border border-[#edf2f8] px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-[#42566f]">{item.details}</span>
                        <span className="text-[#8aa0ba]">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-[#96a7bb]">{shortHash(item.txHash)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <SentimentFeedbackPanel
                onFocusBatch={focusAuditBatch}
                selectedAuditBatchId={selectedAuditBatchId}
              />
            </div>

            <TemperatureAlertPanel role="admin" />
      <SimulatorPanel />
      <SupplyPlannerPanel />

            <div className="mt-4" id="admin-blockchain-audit">
              <BlockchainLog
                title="Admin Blockchain Audit"
                batchIds={auditBatchIds}
                initialBatchId={auditBatchIds[0]}
                selectedBatchId={selectedAuditBatchId}
                onBatchChange={setSelectedAuditBatchId}
                enableSearch
                pollingMs={10000}
                emptyMessage="As batches move through the supply chain, their on-chain timeline will appear here."
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
