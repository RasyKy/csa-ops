import { IncidentsView } from "@/components/IncidentsView";

export default function IncidentsPage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Incidents</h1>
      <IncidentsView />
    </main>
  );
}
