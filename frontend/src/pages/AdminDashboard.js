import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Activity,
  CheckCircle2,
  Bell,
  Brain,
  Database,
  Home,
  Link2,
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
import LiveShipmentVisualizer from "../components/LiveShipmentVisualizer";
import TraceabilityPanel from "../components/TraceabilityPanel";
import GuidedDemoPanel from "../components/GuidedDemoPanel";
import SystemReadinessPanel from "../components/SystemReadinessPanel";
import ReviewerPermissionsPanel from "../components/ReviewerPermissionsPanel";
import SupplyPlannerPanel from "../components/Admin/SupplyPlannerPanel";
import ForecastAnalyticsPanel from "../components/ForecastAnalyticsPanel";
import ForecastExplanation from "../components/ForecastExplanation";
import StatusBadge from "../components/StatusBadge";
import OrderAllocationFields from "../components/Admin/OrderAllocationFields";
import { LogoutButton } from "../components/SessionControls";
import { manualSimulatorConsoleEnabled } from "../config/features";
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
import ManualReadingEntry from "../components/ManualReadingEntry";

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
  document.getElementById(sectionId)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function canFocusBatch(batchId) {
  return Boolean(batchId && batchId !== "--");
}

function isActiveBatch(batchId, selectedBatchId) {
  return canFocusBatch(batchId) && batchId === selectedBatchId;
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
  const [sectionErrors, setSectionErrors] = useState({});
  const [extraAuditIds, setExtraAuditIds] = useState([]);
  const sentimentInFlight = useRef(false);
  const reviewInFlight = useRef(false);
  const [loading, setLoading] = useState({ users: false, monitoring: false, reports: false, workflow: false, orders: false });
  const { addToast } = useToast();

  const setLoadingKey = (key, value) => setLoading((prev) => ({ ...prev, [key]: value }));
  const setSectionError = (key, value) => setSectionErrors((prev) => ({ ...prev, [key]: value }));

  const loadUsers = async (silent = false) => {
    try {
      setLoadingKey("users", true);
      setSectionError("users", "");
      const response = await fetchAdminUsers();
      const nextUsers = Array.isArray(response) ? response : response?.users || [];
      setUsers(nextUsers);
      setUserTotal(response?.total || nextUsers.length);
    } catch (_error) {
      setSectionError("users", "User directory could not be refreshed. Previously loaded records, if any, remain visible.");
      if (!silent) addToast("error", "User management data failed to load");
    } finally {
      setLoadingKey("users", false);
    }
  };

  const loadMonitoring = async (silent = false) => {
    try {
      setLoadingKey("monitoring", true);
      setSectionError("monitoring", "");
      setMonitoring((await fetchAdminMonitoring()) || EMPTY_MONITORING);
    } catch (_error) {
      setSectionError("monitoring", "Monitoring could not be refreshed. Do not interpret an empty or stale feed as healthy telemetry.");
      if (!silent) addToast("error", "Monitoring data failed to load");
    } finally {
      setLoadingKey("monitoring", false);
    }
  };

  const loadReports = async (silent = false) => {
    try {
      setLoadingKey("reports", true);
      setSectionError("reports", "");
      setReports((await fetchAdminReports()) || EMPTY_REPORTS);
    } catch (_error) {
      setSectionError("reports", "Reports could not be refreshed. Previously loaded results may be stale.");
      if (!silent) addToast("error", "Reports data failed to load");
    } finally {
      setLoadingKey("reports", false);
    }
  };

  const loadWorkflow = async (silent = false) => {
    try {
      setLoadingKey("workflow", true);
      setSectionError("workflow", "");
      const response = await fetchAdminWorkflow();
      setWorkflow(response?.workflow || []);
    } catch (_error) {
      setSectionError("workflow", "Workflow status could not be refreshed.");
      if (!silent) addToast("error", "Workflow data failed to load");
    } finally {
      setLoadingKey("workflow", false);
    }
  };

  const loadOrders = async (silent = false) => {
    try {
      setLoadingKey("orders", true);
      setSectionError("orders", "");
      const response = await fetchAdminOrders();
      setAdminOrders(response?.orders || []);
      setAllocationOptions(response?.allocationOptions || []);
      setDistributorOptions(response?.distributors || []);
    } catch (_error) {
      setSectionError("orders", "Order queue could not be refreshed. Refresh successfully before making a decision.");
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
    if (sentimentInFlight.current) return;
    if (!sentimentText.trim()) {
      addToast("error", "Enter text to analyze first.");
      return;
    }
    sentimentInFlight.current = true;
    try {
      setLoadingSentiment(true);
      const result = await runAdminSentiment(sentimentText.trim());
      setSentiment(result || { sentiment: { sentiment: "Neutral", score: 0 } });
      addToast("success", "Sentiment analysis updated");
      await Promise.allSettled([loadMonitoring(true), loadReports(true), loadWorkflow(true)]);
    } catch (error) {
      addToast("error", error.response?.data?.error || "Sentiment analysis failed. Check the AI service and local blockchain.");
    } finally {
      sentimentInFlight.current = false;
      setLoadingSentiment(false);
    }
  };

  const reviewOrderDecision = async (orderId, decision) => {
    if (reviewInFlight.current || sectionErrors.orders) return;
    reviewInFlight.current = true;
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
      reviewInFlight.current = false;
      setReviewingOrder("");
    }
  };

  const summary = monitoring?.summary || EMPTY_MONITORING.summary;
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
      return logs.filter((item) => String(item.status).toLowerCase() === "normal");
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
    labels: reportSeries.length ? reportSeries.map((item) => item.label) : ["Forecast estimate"],
    datasets: [
      {
        label: reports?.reportSeries?.length ? "Recorded vaccination doses" : "Advisory demand estimate",
        data: reportSeries.length ? reportSeries.map((item) => Number(item.value || 0)) : [Number(reports?.forecast?.predicted_demand || 0)],
        borderColor: "#438f66",
        backgroundColor: "rgba(67, 143, 102, 0.15)",
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
      ...adminOrders.map((item) => item.allocatedBatchId),
      ...extraAuditIds,
      ...(monitoring?.temperatureLogs || []).map((item) => item.batchId),
      ...(reports?.insights || []).map((item) => item.batchId),
      ...(monitoring?.batches || []).map((item) => item.batchId),
      ...(monitoring?.shipments || []).map((item) => item.batchId),
      ...(monitoring?.distributions || []).map((item) => item.batchId),
      ...(monitoring?.vaccinations || []).map((item) => item.batchId),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [adminOrders, monitoring, reports, extraAuditIds]);

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
    if (!canFocusBatch(batchId)) return;
    setExtraAuditIds((prev) => prev.includes(batchId) ? prev : [...prev, batchId]);
    setSelectedAuditBatchId(batchId);
    goTo("admin-blockchain-audit");
  };

  return (
    <div className="dashboard-page min-h-screen bg-[linear-gradient(180deg,#eef4fb_0%,#f7fbff_38%,#f3f7fc_100%)] text-[#32435b]">
      <div className="mx-auto max-w-[1500px] px-5"><ManualReadingEntry /></div>
      <header className="dashboard-header bg-gradient-to-r from-[#0c4d96] via-[#2376cb] to-[#3b95e6] px-6 text-white shadow-sm">
        <div className="flex h-full flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15">
              <Shield size={20} />
            </div>
            <h1 className="text-[1.45rem] font-semibold tracking-wide">2026 Smart Vaccine Supply Chain System</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative hidden xl:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70" size={16} />
              <input
                className="w-60 rounded-full border border-white/20 bg-white/12 py-2 pl-9 pr-4 text-sm text-white placeholder-white/60 outline-none"
                aria-label="Search users from header"
                placeholder="Search users or roles..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && goTo("admin-users")}
              />
            </div>
            <button type="button" aria-label="Open temperature alert queue" onClick={() => goTo("admin-cold-chain")} className="relative rounded-lg p-2 hover:bg-white/10">
              <Bell size={18} />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="max-w-[220px] truncate" title={sessionStorage.getItem("userEmail") || "Admin"}>{sessionStorage.getItem("userEmail") || "Admin"}</span>
              <UserCircle2 size={24} />
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard-layout flex">
        <aside className="dashboard-sidebar bg-gradient-to-b from-[#124e97] to-[#206eb9] text-white shadow-xl">
          <nav className="space-y-2 px-3 pt-6 text-[13px]">
            <button type="button" onClick={() => goTo("admin-top")} className="flex w-full items-center gap-2 rounded-lg bg-white/12 px-3 py-3 text-left">
              <Home size={15} />
              <span>Dashboard</span>
            </button>
            <button type="button" onClick={() => goTo("admin-users")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10">
              <Users size={15} />
              <span>User Directory</span>
            </button>
            <button type="button" onClick={() => goTo("admin-demo-mode")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Activity size={15} /><span>Guided Demo</span></button>
            <button type="button" onClick={() => goTo("admin-reviewers")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Shield size={15} /><span>Reviewer Access</span></button>
            <button type="button" onClick={() => goTo("admin-readiness")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Database size={15} /><span>System Readiness</span></button>
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
            <button type="button" onClick={() => goTo("admin-orders")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Package2 size={15} /><span>Order Review</span></button>
            <button type="button" onClick={() => goTo("admin-cold-chain")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Thermometer size={15} /><span>Cold Chain & IoT</span></button>
            {manualSimulatorConsoleEnabled ? <Link to="/admin/manual-simulator" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10"><Thermometer size={15} /><span>Manual Sensor Console</span></Link> : null}
            <button type="button" onClick={() => goTo("admin-supply-plan")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Truck size={15} /><span>Supply Planning</span></button>
            <button type="button" onClick={() => goTo("forecast-analytics")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Truck size={15} /><span>Forecast Analytics</span></button>
            <button type="button" onClick={() => goTo("admin-blockchain-audit")} className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left hover:bg-white/10"><Link2 size={15} /><span>Blockchain Audit</span></button>
            <Link to="/architecture" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10"><Database size={15} /><span>Architecture Status</span></Link>
            <LogoutButton className="flex w-full items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10" />
          </nav>
        </aside>

        <main className="dashboard-main min-w-0 flex-1 px-5 py-5">
          <div className="dashboard-content mx-auto max-w-[1440px]" id="admin-top">
            <div className="mb-1 text-[12px] text-[#92a0b2]">Home / Dashboard</div>
            <h2 className="mb-5 text-[1.95rem] font-semibold text-[#2d4a73]">Admin Dashboard</h2>
            {Object.values(sectionErrors).some(Boolean) && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Some dashboard data is unavailable</p>
              <ul className="my-2 list-disc pl-5">{Object.entries(sectionErrors).filter(([, message]) => message).map(([key, message]) => <li key={key}>{message}</li>)}</ul>
              <button type="button" onClick={loadPage} disabled={loadingPage} className="rounded-lg border border-amber-400 px-3 py-2 font-semibold disabled:opacity-50">Retry dashboard data</button>
            </div>}
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Package2} label="Batches" value={summary.batches} accent="text-[#2b68c6]" badge="bg-[#e8f1ff] text-[#2f7fd4]" />
              <MetricCard icon={Truck} label="Shipments" value={summary.shipments} accent="text-[#2ea67f]" badge="bg-[#e8fbf3] text-[#2ea67f]" />
              <MetricCard icon={Link2} label="Blockchain Logs" value={summary.blockchainLogs} accent="text-[#d08337]" badge="bg-[#fff1df] text-[#d08337]" />
              <MetricCard icon={Thermometer} label="Temp Alerts" value={summary.tempAlerts} accent="text-[#de6666]" badge="bg-[#fff0f0] text-[#de6666]" />
            </div>

            <div className="mb-6"><LiveShipmentVisualizer compact maxVisible={3} /></div>

            <div className="mb-6"><GuidedDemoPanel /></div>

            <div className="mb-6 grid grid-cols-1 gap-5 2xl:grid-cols-[0.9fr_1.1fr_0.8fr]" id="admin-monitoring">
              <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
                <PanelHeader title="Admin Workflow" description="Live DFD step completion for the admin module." loading={loading.workflow} onRefresh={() => loadWorkflow()} />
                <div className="space-y-3">
                  {workflow.map((step, index) => (
                    <div key={index} className="flex items-center justify-between rounded-xl border border-[#edf2f8] px-3 py-3">
                      <span className="text-sm text-[#42566f]">{step.step}</span>
                      <StatusBadge value={step.status} />
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
                      disabled={!canFocusBatch(row.title)}
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
                          <StatusBadge value={row.status} />
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
                        disabled={!canFocusBatch(record.batchId)}
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
                    <div className="text-[11px] uppercase tracking-wide text-[#d18a8a]">Historical alert readings</div>
                    <div className="mt-1 flex items-center gap-2 text-xl font-bold text-[#d85a5a]">
                      <AlertTriangle size={18} />
                      {summary.tempAlerts}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#f4fbf7] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#7fb294]">Normal recent readings</div>
                    <div className="mt-1 flex items-center gap-2 text-xl font-bold text-[#2ea67f]">
                      <CheckCircle2 size={18} />
                      {(monitoring?.temperatureLogs || []).filter((item) => item.status === "Normal").length}
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
                      disabled={!canFocusBatch(alert.batchId)}
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
                        <StatusBadge value={alert.status} />
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

            <div id="admin-orders" className="mb-4 rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
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
                            disabled={!canFocusBatch(order.allocatedBatchId || order.auditBatchId)}
                            onClick={() => focusAuditBatch(order.allocatedBatchId || order.auditBatchId)}
                            className="font-semibold text-[#42566f] hover:text-[#2f8ae0]"
                          >
                            {order.orderId}
                          </button>
                          <StatusBadge value={order.status} />
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
                      <div className="w-full space-y-2 xl:max-w-[360px]">
                        <OrderAllocationFields order={order} options={allocationOptions} distributors={distributorOptions}
                          busy={Boolean(reviewingOrder) || loading.orders || Boolean(sectionErrors.orders)}
                          value={allocations[order.orderId] || { batchId: order.allocatedBatchId, distributor: order.distributor }}
                          onChange={value => setAllocations(prev => ({ ...prev, [order.orderId]: value }))} />
                        <textarea
                          rows={2}
                          aria-label={`Decision note for ${order.orderId}`}
                          disabled={order.status !== "Pending" || Boolean(reviewingOrder)}
                          maxLength={2000}
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
                            disabled={order.status !== "Pending" || Boolean(reviewingOrder) || loading.orders || Boolean(sectionErrors.orders) || !allocationOptions.some((batch) => batch.batchId === allocations[order.orderId]?.batchId && batch.vaccineType === order.vaccineType && batch.eligible && batch.remainingDoses >= order.requestedDoses) || !distributorOptions.includes(allocations[order.orderId]?.distributor)}
                            className="flex-1 rounded-xl bg-[#2ea67f] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => reviewOrderDecision(order.orderId, "Decline")}
                            disabled={order.status !== "Pending" || Boolean(reviewingOrder) || loading.orders || Boolean(sectionErrors.orders)}
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

            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
              <div id="admin-users" className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
                <PanelHeader title="User Directory" description={`View ${userTotal} registered users. Account changes are not available in this read-only directory.`} loading={loading.users} onRefresh={() => loadUsers()} />
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    aria-label="Search user or role"
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
                            <StatusBadge value={user.status} />
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
                <PanelHeader title="Reports & Insights" description="Recorded vaccination history and advisory estimates; not validated demand predictions." loading={loading.reports} onRefresh={() => loadReports()} />
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
                <p className="mt-2 text-xs text-slate-600">{reports?.reportSeries?.length ? "Chart: recorded vaccination dose history, not a forecast." : "Chart: advisory estimates only; zero may indicate insufficient history."}</p>
                <div className="mt-4 space-y-2">
                  {(reports?.insights || []).map((item, index) => (
                    <button
                      key={`${item.batchId}-${index}`}
                      type="button"
                      disabled={!canFocusBatch(item.batchId)}
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
                <ForecastExplanation forecast={reports?.forecast} loading={loading.reports || loadingPage} />
              </div>

              <div id="admin-sentiment" className="rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm">
                <PanelHeader title="Sentiment Analysis" description="Run multilingual sentiment analysis and log it on-chain." loading={loadingSentiment} />
                <label htmlFor="admin-sentiment-text" className="mb-2 block text-sm font-medium">Text to analyze</label>
                <textarea id="admin-sentiment-text" disabled={loadingSentiment} maxLength={10000} className="mb-3 w-full rounded-xl border border-[#dfe7f1] px-3 py-2.5 text-sm" rows={4} value={sentimentText} onChange={(e) => setSentimentText(e.target.value)} />
                <button type="button" onClick={runSentiment} disabled={loadingSentiment || !sentimentText.trim()} className="mb-4 w-full rounded-xl bg-[#2f8ae0] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
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

            <div className="mt-5"><ReviewerPermissionsPanel /></div>

            <section id="admin-cold-chain" className="mt-6 space-y-5"><TemperatureAlertPanel role="admin" /><SimulatorPanel /></section>
            <div id="shipment-journey"><TraceabilityPanel /></div>
            <div className="mt-5"><SystemReadinessPanel /></div>
            <SupplyPlannerPanel />
            <ForecastAnalyticsPanel role="admin" />

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
