import Link from "next/link";

// Admin landing — links to the three admin sections (PRD §14.2).
// Each section's page is built in later steps; the links are here from the
// start so the nav is consistent.

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          href="/admin/settings"
          title="Settings"
          description="API keys, default models, model catalogue, cost dashboard."
        />
        <Card
          href="/admin/prompts"
          title="Prompts"
          description="Prompt registry, editor, model bindings, test panel."
        />
        <Card
          href="/admin/extractions"
          title="Extractions"
          description="Extraction quality aggregates, delta drill-in, annotations."
        />
      </div>
    </div>
  );
}

function Card({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-white/10 p-4 hover:border-white/30"
    >
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 text-xs text-white/50">{description}</p>
    </Link>
  );
}
