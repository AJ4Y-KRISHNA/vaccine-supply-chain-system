import React, { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Factory,
  Shield,
  Stethoscope,
  Truck,
  Users,
} from "lucide-react";
import { useToast } from "../components/Toast";
import {
  fetchAdminMonitoring,
  fetchAdminWorkflow,
  fetchDistributorWorkflow,
  fetchManufacturerWorkflow,
  fetchVaccinationWorkflow,
} from "../services/workflow";

function StepCard({ title, status, detail }) {
  const complete = !String(status || "").toLowerCase().includes("pending");
  return (
    <div className="rounded-xl border border-[#e6eef8] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[#42566f]">{title}</h4>
        <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${complete ? "bg-[#e8f7ef] text-[#2ea67f]" : "bg-[#fff4df] text-[#cf8a26]"}`}>
          {status}
        </span>
      </div>
      <p className="mt-2 text-xs text-[#8a9ab0]">{detail}</p>
    </div>
  );
}

function ModuleCard({ icon: Icon, title, subtitle, steps }) {
  return (
    <div className="rounded-[14px] border border-[#e6eef8] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef5ff] text-[#3178d5]">
          <Icon size={22} />
        </div>
        <div>
          <h3 className="text-[1.05rem] font-semibold text-[#42566f]">{title}</h3>
          <p className="text-xs text-[#8a9ab0]">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-3">
        {steps.map((step, index) => (
          <StepCard key={index} {...step} />
        ))}
      </div>
    </div>
  );
}

function ArchitectureStatus() {
  const [modules, setModules] = useState(null);
  const { addToast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const [manufacturer, distributor, vaccination, adminWorkflow, adminMonitoring] = await Promise.all([
          fetchManufacturerWorkflow(),
          fetchDistributorWorkflow(),
          fetchVaccinationWorkflow(),
          fetchAdminWorkflow(),
          fetchAdminMonitoring(),
        ]);

        setModules({
          manufacturer: [
            {
              title: "1.1 Receive Raw Materials",
              status: manufacturer.rawMaterials?.length ? "Completed" : "Pending",
              detail: `${manufacturer.rawMaterials?.length || 0} raw material entries recorded`,
            },
            {
              title: "1.2 Produce Vaccine",
              status: manufacturer.productions?.length ? "Completed" : "Pending",
              detail: `${manufacturer.productions?.length || 0} production entries recorded`,
            },
            {
              title: "1.3 Create Vaccine Batch",
              status: manufacturer.batches?.length ? "Completed" : "Pending",
              detail: `${manufacturer.batches?.length || 0} batch entries recorded`,
            },
            {
              title: "1.4 Create Batch Report",
              status: manufacturer.reports?.length ? "Completed" : "Pending",
              detail: `${manufacturer.reports?.length || 0} batch reports generated`,
            },
          ],
          distributor: [
            {
              title: "1.1 Receive Vaccine Batch",
              status: distributor.shipments?.length ? "Completed" : "Pending",
              detail: `${distributor.shipments?.length || 0} shipment entries recorded`,
            },
            {
              title: "1.2 Verify Vaccine Details",
              status: distributor.verificationQueue?.length ? "Completed" : "Pending",
              detail: `${distributor.verificationQueue?.length || 0} verified shipments`,
            },
            {
              title: "1.3 Update Distribution Information",
              status: distributor.temperatureLogs?.length ? "Completed" : "Pending",
              detail: `${distributor.temperatureLogs?.length || 0} monitoring logs captured`,
            },
            {
              title: "1.4 Vaccine Supply",
              status: distributor.suppliedShipments?.length ? "Completed" : "Pending",
              detail: `${distributor.suppliedShipments?.length || 0} shipments supplied to centers`,
            },
          ],
          vaccination: [
            {
              title: "1.1 Vaccine Request",
              status: vaccination.requests?.length ? "Completed" : "Pending",
              detail: `${vaccination.requests?.length || 0} request entries logged`,
            },
            {
              title: "1.2 Stock Management",
              status: vaccination.inventory?.length ? "Completed" : "Pending",
              detail: `${vaccination.inventory?.length || 0} inventory updates logged`,
            },
            {
              title: "1.3 Administer Vaccines",
              status: vaccination.administrations?.length ? "Completed" : "Pending",
              detail: `${vaccination.administrations?.length || 0} vaccination entries logged`,
            },
            {
              title: "1.4 Record & Report",
              status: vaccination.reports?.length ? "Completed" : "Pending",
              detail: `${vaccination.reports?.length || 0} blockchain-ready reports logged`,
            },
          ],
          admin: (adminWorkflow.workflow || []).map((step) => ({
            title: step.step,
            status: step.status,
            detail: `Monitoring summary: ${adminMonitoring.summary?.blockchainLogs || 0} blockchain logs, ${adminMonitoring.summary?.tempAlerts || 0} alerts`,
          })),
        });
      } catch (_err) {
        addToast("error", "Architecture status failed to load");
      }
    };

    load();
  }, [addToast]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#eef4fb_0%,#f7fbff_38%,#f3f7fc_100%)] px-5 py-6 text-[#32435b]">
      <div className="mx-auto max-w-[1240px]">
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eaf2ff] text-[#3178d5]">
            <Shield size={22} />
          </div>
          <div>
            <h1 className="text-[2rem] font-semibold text-[#2d4a73]">Architecture Status</h1>
            <p className="text-sm text-[#8a9ab0]">Live DFD completion view across manufacturer, distributor, vaccination center, and admin modules.</p>
          </div>
        </div>

        <div className="mb-6 rounded-[14px] border border-[#e6eef8] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-[#58728f]">
            <Activity size={16} />
            <span>This page is driven by live backend workflow endpoints, not mock progress.</span>
          </div>
        </div>

        {modules && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ModuleCard icon={Factory} title="Manufacturer Module" subtitle="Raw materials -> production -> batch -> report" steps={modules.manufacturer} />
            <ModuleCard icon={Truck} title="Distributor Module" subtitle="Receive -> verify -> update -> supply" steps={modules.distributor} />
            <ModuleCard icon={Stethoscope} title="Vaccination Center Module" subtitle="Request -> inventory -> administer -> report" steps={modules.vaccination} />
            <ModuleCard icon={Users} title="Admin Module" subtitle="User management -> monitoring -> insights -> sentiment" steps={modules.admin} />
          </div>
        )}

        {!modules && (
          <div className="mt-10 flex items-center justify-center text-[#8a9ab0]">
            <CheckCircle2 className="mr-2" size={18} />
            Loading architecture status...
          </div>
        )}
      </div>
    </div>
  );
}

export default ArchitectureStatus;
