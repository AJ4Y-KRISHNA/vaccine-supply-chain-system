import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import LiveShipmentVisualizer from "../components/LiveShipmentVisualizer";

export default function LiveShipmentPage() {
  const [searchParams] = useSearchParams();
  const shipmentId = searchParams.get("shipmentId") || "";
  const dashboardPath = { admin: "/admin", manufacturer: "/manufacturer", distributor: "/distributor", healthcare: "/hospital" }[String(localStorage.getItem("role") || "").toLowerCase()] || "/";
  return <main className="min-h-screen bg-surface-page px-4 py-6 text-ink-800 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-brand-900 px-5 py-4 text-white shadow-panel">
        <div className="flex items-center gap-3"><Shield aria-hidden="true" /><div><p className="text-xs font-semibold uppercase tracking-wider text-brand-100">Vaccine supply chain · software demo</p><h1 className="text-xl font-bold">Live shipment view</h1></div></div>
        <Link className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10" to={dashboardPath}><ArrowLeft aria-hidden="true" size={16} /> Back to dashboard</Link>
      </header>
      <LiveShipmentVisualizer shipmentId={shipmentId} maxVisible={5} title={shipmentId ? `Shipment ${shipmentId}` : "Role-visible shipments"} />
    </div>
  </main>;
}
