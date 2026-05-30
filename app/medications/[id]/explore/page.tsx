import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveParams } from "@/lib/pharmacokinetics";
import { ExploreForm } from "./explore-form";

// Regimen explorer (PRD §4.9, §5.7). Server component loads the drug's
// actual PK params, client form lets the user construct hypothetical
// regimens and see the curve shape. No ranking, no recommendation.

export default async function ExplorePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: medicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: med } = await supabase
    .from("medications")
    .select("id, display_name, canonical_drug_id")
    .eq("id", medicationId)
    .single();
  if (!med) notFound();

  // Load chosen regimen for defaults.
  const { data: chosen } = await supabase
    .from("chosen_regimens")
    .select("dose_amount, dose_unit, route, frequency")
    .eq("medication_id", medicationId)
    .eq("active", true)
    .single();

  // Load the drug's PK params if available.
  let defaults = {
    doseAmount: chosen?.dose_amount ? String(chosen.dose_amount) : "100",
    intervalDays: "7",
    halfLife: "192",
    bioavailability: "1.0",
    tmax: "96",
    kernel: "bateman" as string,
  };

  if (med.canonical_drug_id && chosen?.route) {
    const { data: drug } = await supabase
      .from("drugs")
      .select(
        "half_life_hours, bioavailability, tmax_hours, kernel_by_route"
      )
      .eq("id", med.canonical_drug_id)
      .single();

    if (drug) {
      const params = resolveParams(
        drug as unknown as {
          half_life_hours: Record<string, number>;
          bioavailability?: Record<string, number>;
          tmax_hours?: Record<string, number>;
          kernel_by_route?: Record<string, string>;
        },
        chosen.route as string
      );
      if (params) {
        defaults = {
          doseAmount: chosen.dose_amount ? String(chosen.dose_amount) : "100",
          intervalDays: "7",
          halfLife: String(params.halfLifeHours),
          bioavailability: String(params.bioavailability),
          tmax: String(params.tmaxHours),
          kernel: params.kernel,
        };
      }
    }
  }

  return (
    <ExploreForm
      medicationId={medicationId}
      medicationName={med.display_name}
      defaults={defaults}
    />
  );
}
