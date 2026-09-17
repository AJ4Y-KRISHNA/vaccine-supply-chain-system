import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Shield, Package, CheckCircle, AlertOctagon,
  Home, PlusCircle, History, FileText, LogOut,
  User, ChevronDown, Lock, BadgeCheck, Factory
} from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { fetchManufacturerDashboard, signManufacturerBatchRelease } from "../services/dashboard";
import { useToast } from "../components/Toast";
import BlockchainLog from "../components/BlockchainLog";
import TemperatureAlertPanel from "../components/TemperatureAlertPanel";
import SimulatorPanel from "../components/SimulatorPanel";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const defaultSeries = [40000, 42000, 60000, 72000, 78000];
const defaultLabels = ["Nov", "Dec", "Jan", "Feb", "Apr"];

const distributionOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        usePointStyle: true,
        boxWidth: 8,
        color: "#687a92",
        padding: 18,
      },
    },
  },
  scales: {
    y: {
      min: 0,
      ticks: {
        callback: (value) => (value === 0 ? "0" : `${value / 1000}k`),
        color: "#8a9ab0",
        font: { size: 11 },
      },
      grid: { borderDash: [4, 4], color: "#edf3fb" },
    },
    x: {
      grid: { display: false },
      ticks: {
        color: "#8a9ab0",
        font: { size: 11 },
      },
    },
  },
};

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("released")) return "bg-[#44c5a1] text-white";
  if (normalized.includes("awaiting")) return "bg-[#eef5ff] text-[#3278d7]";
  if (normalized.includes("blockchain")) return "bg-[#7cc3ff] text-white";
  return "bg-[#ffcb6f] text-[#8a5a00]";
}

function releaseChip(enabled) {
  return enabled ? "bg-[#e8f7ef] text-[#2ea67f]" : "bg-[#eef5ff] text-[#3278d7]";
}

function HeatmapPanel({ data }) {
  return (
    <div className="relative h-[320px] overflow-hidden rounded-[14px] border border-[#e5edf7] bg-[linear-gradient(180deg,#eff7ff_0%,#f7fbff_100%)] p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-[1.1rem] font-semibold text-[#42566f]">Global Demand Heatmap</h3>
          <p className="mt-1 text-[12px] text-[#8a9ab0]">CNN-LSTM forecast outlook by region and vaccine priority.</p>
        </div>
        <div className="rounded-full bg-[#eef5ff] px-3 py-1 text-[11px] font-semibold text-[#3278d7]">
          Next-month planning
        </div>
      </div>

      <div className="absolute inset-x-5 top-[88px] bottom-5 rounded-[18px] border border-[#d6e7fa] bg-[linear-gradient(180deg,#f8fcff,#eef6ff)] shadow-inner">
        <div className="absolute left-[8%] top-[18%] h-[56%] w-[18%] rounded-[48%] bg-[#dbeeff] opacity-80" />
        <div className="absolute left-[31%] top-[22%] h-[36%] w-[14%] rounded-[44%] bg-[#d2e7ff] opacity-90" />
        <div className="absolute left-[46%] top-[18%] h-[45%] w-[14%] rounded-[45%] bg-[#cfe4ff] opacity-90" />
        <div className="absolute left-[56%] top-[26%] h-[18%] w-[12%] rounded-[45%] bg-[#d7ebff] opacity-90" />
        <div className="absolute left-[62%] top-[30%] h-[34%] w-[20%] rounded-[45%] bg-[#c8dff8] opacity-85" />
        <div className="absolute left-[80%] top-[70%] h-[14%] w-[10%] rounded-[45%] bg-[#d7ebff] opacity-90" />

        {data.map((entry) => (
          <div
            key={`${entry.region}-${entry.priorityVaccine}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
          >
            <div className="flex flex-col items-center">
              <div
                className="rounded-full border-4 border-white shadow-lg"
                style={{
                  width: `${18 + Math.round((entry.intensity || 0.2) * 28)}px`,
                  height: `${18 + Math.round((entry.intensity || 0.2) * 28)}px`,
                  background: "radial-gradient(circle at 35% 35%, #ffd086, #ff7f50 58%, #e24646 100%)",
                }}
              />
              <div className="mt-1.5 rounded-md bg-white/95 px-2 py-1 text-[10px] font-semibold text-[#35567d] shadow-sm">
                {entry.region}
              </div>
            </div>
          </div>
        ))}

        {!data.length && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#8fa1b8]">
            Submit region orders to generate forecast hotspots.
          </div>
        )}
      </div>
    </div>
  );
}

function ManufacturerDashboard() {
  const [cards, setCards] = useState({
    totalBatches: 0,
    pendingShipments: 0,
    totalDistributed: 0,
    lowAlerts: 0,
    certificatesMinted: 0,
    releasedBatches: 0,
  });
  const [batches, setBatches] = useState([]);
  const [txHistory, setTxHistory] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [series, setSeries] = useState(defaultSeries);
  const [seriesLabels, setSeriesLabels] = useState(defaultLabels);
  const [loadingBatchId, setLoadingBatchId] = useState("");
  const { addToast } = useToast();
  const auditBatchIds = useMemo(
    () => batches.map((batch) => batch.id).filter(Boolean),
    [batches]
  );

  const reloadDashboard = async () => {
    const data = await fetchManufacturerDashboard();
    setCards(data.cards || {
      totalBatches: 0,
      pendingShipments: 0,
      totalDistributed: 0,
      lowAlerts: 0,
      certificatesMinted: 0,
      releasedBatches: 0,
    });
    setBatches(
      (data.batches || []).map((batch) => ({
        id: batch.batchId,
        type: batch.vaccineType || "Mixed",
        qty: (batch.quantity || 0).toLocaleString(),
        status: batch.coldChainStatus || batch.status || "Pending",
        coldChainStatus: batch.coldChainStatus,
        baselineDemandForecast: batch.baselineDemandForecast || 0,
        certificateMinted: Boolean(batch.certificateMinted),
        certificateId: batch.certificateId || "",
        releaseVisibleToExternal: Boolean(batch.releaseVisibleToExternal),
        releaseStage: batch.releaseStage || "Awaiting Production Sign-Off",
        productionApproved: Boolean(batch.productionApproved),
        labApproved: Boolean(batch.labApproved),
      }))
    );
    setTxHistory(
      (data.txHistory || []).map((tx) => ({
        id: tx.batchId,
        time: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "--",
        hash: tx.hash || "pending",
      }))
    );
    setCertificates(data.certificates || []);
    setHeatmap(data.demandHeatmap || []);
    const nextSeries = (data.distributionSeries || []).map((point) => point.value);
    const nextLabels = (data.distributionSeries || []).map((point) => point.label);
    setSeries(nextSeries.length ? nextSeries : defaultSeries);
    setSeriesLabels(nextLabels.length ? nextLabels : defaultLabels);
  };

  useEffect(() => {
    reloadDashboard().catch(() => addToast("error", "Manufacturer dashboard failed to load"));
  }, [addToast]);

  const signRelease = async (batchId, role) => {
    try {
      setLoadingBatchId(`${batchId}:${role}`);
      await signManufacturerBatchRelease(batchId, {
        role,
        signer: role === "Production" ? "Production Officer" : "Lab Testing Officer",
      });
      addToast("success", `${role} sign-off saved`);
      await reloadDashboard();
    } catch (err) {
      addToast("error", err?.response?.data?.error || `Unable to complete ${role} sign-off`);
    } finally {
      setLoadingBatchId("");
    }
  };

  const distributionData = {
    labels: seriesLabels,
    datasets: [
      {
        label: "Vaccines Distributed",
        data: series.length ? series : defaultSeries,
        borderColor: "#5b9df0",
        backgroundColor: "rgba(91, 157, 240, 0.18)",
        tension: 0.35,
        fill: true,
        pointBackgroundColor: "#5b9df0",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 5,
      },
    ],
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#eef4fb_0%,#f7fbff_38%,#f3f7fc_100%)] text-[#32435b]">
      <header className="h-16 bg-gradient-to-r from-[#0b4a91] via-[#1e73c8] to-[#3c93e8] text-white px-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-white/30 bg-white/15 flex items-center justify-center">
            <Shield size={20} />
          </div>
          <h1 className="text-[1.45rem] font-semibold tracking-wide">2026 Smart Vaccine Supply Chain System</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>Manufacturer</span>
          <div className="w-8 h-8 rounded-full bg-white/90 text-[#245ea7] flex items-center justify-center">
            <User size={18} />
          </div>
          <ChevronDown size={16} />
        </div>
      </header>

      <div className="flex">
        <aside className="w-[120px] min-h-[calc(100vh-64px)] bg-gradient-to-b from-[#114d96] to-[#1a6fbd] text-white shadow-xl">
          <nav className="pt-6 px-3 space-y-2 text-[13px]">
            <Link to="#" className="flex items-center gap-2 rounded-lg bg-white/12 px-3 py-3">
              <Home size={15} />
              <span>Dashboard</span>
            </Link>
            <Link to="#" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <PlusCircle size={15} />
              <span>Create New Batch</span>
            </Link>
            <Link to="#" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <History size={15} />
              <span>Batch History</span>
            </Link>
            <Link to="#" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <FileText size={15} />
              <span>Quality Certificates</span>
            </Link>
            <Link to="/" className="flex items-center gap-2 rounded-lg px-3 py-3 hover:bg-white/10">
              <LogOut size={15} />
              <span>Logout</span>
            </Link>
          </nav>

          <div className="mt-8 mx-3 rounded-xl border border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-4 min-h-[360px] flex flex-col items-center justify-end">
            <div className="w-16 h-24 rounded-t-full bg-white/10 border border-white/20 mb-6"></div>
            <div className="w-full h-32 rounded-xl bg-[linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0.03))] relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.3),transparent_25%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.25),transparent_30%)]"></div>
              <div className="absolute left-4 top-7 h-px w-16 bg-white/30 rotate-[18deg]"></div>
              <div className="absolute right-3 top-11 h-px w-14 bg-white/25 -rotate-[12deg]"></div>
              <div className="absolute inset-0 flex items-center justify-center opacity-60">
                <Lock size={36} />
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 px-5 py-5">
          <div className="mx-auto max-w-[1240px]">
            <div className="text-[12px] text-[#92a0b2] mb-1">Home / Dashboard</div>
            <h2 className="text-[1.95rem] font-semibold text-[#2d4a73] mb-5">Manufacturer Dashboard</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 mb-5">
              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[#e7f1ff] text-[#3a84da] flex items-center justify-center">
                  <Shield size={26} />
                </div>
                <div>
                  <p className="text-[13px] text-[#6f8094]">Total Vaccine Batches</p>
                  <div className="text-[2rem] font-bold text-[#26384f]">{cards.totalBatches}</div>
                </div>
              </div>

              <div className="rounded-[14px] bg-[#f5fffb] border border-[#e2f4ee] shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[#e5fbf2] text-[#2ea67f] flex items-center justify-center">
                  <Package size={26} />
                </div>
                <div>
                  <p className="text-[13px] text-[#6f8094]">Pending Release</p>
                  <div className="text-[2rem] font-bold text-[#26384f]">{cards.pendingShipments}</div>
                </div>
              </div>

              <div className="rounded-[14px] bg-gradient-to-r from-[#4b97f5] to-[#3a82df] text-white shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-white/18 flex items-center justify-center">
                  <CheckCircle size={26} />
                </div>
                <div>
                  <p className="text-[13px] text-white/80">Total Distributed</p>
                  <div className="text-[2rem] font-bold">{Number(cards.totalDistributed || 0).toLocaleString()}</div>
                </div>
              </div>

              <div className="rounded-[14px] bg-gradient-to-r from-[#f06a6a] to-[#e85353] text-white shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-white/18 flex items-center justify-center">
                  <AlertOctagon size={26} />
                </div>
                <div>
                  <p className="text-[13px] text-white/80">Low Inventory Alerts</p>
                  <div className="text-[2rem] font-bold">{cards.lowAlerts}</div>
                </div>
              </div>

              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[#f4edff] text-[#8b5cf6] flex items-center justify-center">
                  <BadgeCheck size={26} />
                </div>
                <div>
                  <p className="text-[13px] text-[#6f8094]">Certificates Minted</p>
                  <div className="text-[2rem] font-bold text-[#26384f]">{cards.certificatesMinted}</div>
                </div>
              </div>

              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[#fef2f2] text-[#ef4444] flex items-center justify-center">
                  <Factory size={26} />
                </div>
                <div>
                  <p className="text-[13px] text-[#6f8094]">Released Batches</p>
                  <div className="text-[2rem] font-bold text-[#26384f]">{cards.releasedBatches}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-5 mb-5">
              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm p-5">
                <h3 className="text-[1.1rem] font-semibold text-[#42566f] mb-4">Distribution Overview</h3>
                <div className="h-[260px]">
                  <Line data={distributionData} options={distributionOptions} />
                </div>
              </div>

              <HeatmapPanel data={heatmap} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-5 mb-5">
              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[1.1rem] font-semibold text-[#42566f]">Recent Vaccine Batches</h3>
                  <span className="text-[#b5bfd0]">...</span>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-[12.5px]">
                    <thead className="text-left text-[#7d8ca0] border-b border-[#edf2f8]">
                      <tr>
                        <th className="py-2">Batch ID</th>
                        <th className="py-2">Vaccine Type</th>
                        <th className="py-2">Quantity</th>
                        <th className="py-2">Status</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((batch) => (
                        <tr key={batch.id} className="border-b border-[#f4f7fb] text-[#53657b] align-top">
                          <td className="py-2.5 font-medium">
                            <div>{batch.id}</div>
                            <div className="mt-1 text-[11px] text-[#90a1b6]">
                              Baseline {Number(batch.baselineDemandForecast || 0).toLocaleString()}
                            </div>
                          </td>
                          <td className="py-2.5">{batch.type}</td>
                          <td className="py-2.5">{batch.qty}</td>
                          <td className="py-2.5">
                            <div className="flex flex-col gap-2">
                              <span className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${statusClass(batch.coldChainStatus || batch.releaseStage || batch.status)}`}>
                                {batch.coldChainStatus || batch.releaseStage || batch.status}
                              </span>
                              <div className="flex flex-wrap gap-2 text-[11px]">
                                <span className={`rounded-md px-2 py-1 ${releaseChip(batch.productionApproved)}`}>
                                  Production
                                </span>
                                <span className={`rounded-md px-2 py-1 ${releaseChip(batch.labApproved)}`}>
                                  Lab
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                disabled={batch.productionApproved || !!loadingBatchId}
                                onClick={() => signRelease(batch.id, "Production")}
                                className={`rounded-md px-3 py-1.5 text-[11px] font-medium text-white ${
                                  batch.productionApproved ? "bg-[#2ea67f]" : "bg-[#438ce8]"
                                }`}
                              >
                                {loadingBatchId === `${batch.id}:Production`
                                  ? "Signing..."
                                  : batch.productionApproved
                                  ? "Production Signed"
                                  : "Production Sign"}
                              </button>
                              <button
                                disabled={batch.labApproved || !!loadingBatchId}
                                onClick={() => signRelease(batch.id, "Lab Testing")}
                                className={`rounded-md px-3 py-1.5 text-[11px] font-medium text-white ${
                                  batch.labApproved ? "bg-[#2ea67f]" : "bg-[#8b5cf6]"
                                }`}
                              >
                                {loadingBatchId === `${batch.id}:Lab Testing`
                                  ? "Signing..."
                                  : batch.labApproved
                                  ? "Lab Signed"
                                  : "Lab Sign"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!batches.length && (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-[#9cacbf]">No batch records available yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[1.1rem] font-semibold text-[#42566f]">Smart Inventory Minting</h3>
                  <span className="rounded-full bg-[#eef5ff] px-3 py-1 text-[11px] font-semibold text-[#3278d7]">AI baseline certificates</span>
                </div>
                <div className="space-y-3">
                  {certificates.map((certificate) => (
                    <div key={certificate.certificateId} className="rounded-xl border border-[#edf2f8] bg-[#fbfdff] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[#314762]">{certificate.certificateId}</p>
                          <p className="mt-1 text-sm text-[#7f91a7]">
                            {certificate.batchId} - {certificate.vaccineType}
                          </p>
                        </div>
                        <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${releaseChip(certificate.releaseVisibleToExternal)}`}>
                          {certificate.releaseVisibleToExternal ? "Released" : "Locked"}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-[12px] text-[#6f8094]">
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-[#8aa0ba]">AI Demand Baseline</div>
                          <div className="mt-1 text-lg font-bold text-[#2d4a73]">{Number(certificate.predictedDemand || 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="text-[#8aa0ba]">Minted On</div>
                          <div className="mt-1 text-sm font-semibold text-[#2d4a73]">
                            {certificate.issuedAt ? new Date(certificate.issuedAt).toLocaleString() : "--"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!certificates.length && (
                    <div className="rounded-xl border border-dashed border-[#d9e3ef] bg-[#f9fbfe] p-8 text-center text-sm text-[#9aaabd]">
                      Register a batch to mint a digital inventory certificate.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-5">
              <div className="rounded-[14px] bg-white border border-[#e5edf7] shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[1.1rem] font-semibold text-[#42566f]">Blockchain Transaction History</h3>
                  <span className="text-[#b5bfd0]">...</span>
                </div>
                <div className="overflow-auto mb-4">
                  <table className="w-full text-[12.5px]">
                    <thead className="text-left text-[#7d8ca0] border-b border-[#edf2f8]">
                      <tr>
                        <th className="py-2">Batch ID</th>
                        <th className="py-2">Timestamp</th>
                        <th className="py-2">Transaction Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txHistory.map((tx) => (
                        <tr key={`${tx.id}-${tx.hash}`} className="border-b border-[#f4f7fb] text-[#53657b]">
                          <td className="py-2.5 font-medium">{tx.id}</td>
                          <td className="py-2.5">{tx.time}</td>
                          <td className="py-2.5 font-mono text-[11px]">{tx.hash}</td>
                        </tr>
                      ))}
                      {!txHistory.length && (
                        <tr>
                          <td colSpan="3" className="py-8 text-center text-[#9cacbf]">No blockchain transactions available yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <BlockchainLog
                title="Manufacturer Blockchain Audit"
                batchIds={auditBatchIds}
                initialBatchId={auditBatchIds[0]}
                emptyMessage="Create and log a batch to see the on-chain manufacturing timeline."
              />
            </div>

            <TemperatureAlertPanel role="manufacturer" />
            <SimulatorPanel />
          </div>
        </main>
      </div>
    </div>
  );
}

export default ManufacturerDashboard;
