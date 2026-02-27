import { Suspense } from "react";
import EVReadyWizard from "@/components/EVReadyWizard";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white p-6">Loading…</div>}>
      <EVReadyWizard />
    </Suspense>
  );
}