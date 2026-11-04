import React from "react";
import { Link, useParams } from "react-router-dom";
import BatchVerificationPanel from "../components/BatchVerificationPanel";
import BatchVerificationQr from "../components/BatchVerificationQr";
export default function BatchVerifyPage() {
  const { batchId } = useParams();
  return <main className="mx-auto max-w-5xl p-6">
    <h1 className="mb-4 text-2xl font-semibold text-emerald-900">Batch verification</h1>
    <div className="mb-4 flex justify-end"><BatchVerificationQr batchId={batchId} /></div>
    <BatchVerificationPanel initialCode={batchId} />
    <Link to="/" className="text-emerald-800 underline">Return to sign in</Link>
  </main>;
}
