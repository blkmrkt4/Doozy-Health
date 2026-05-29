import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Drug-name lookup against the reference catalogue (PRD §13.3). Authenticated;
// `drugs` is readable by any signed-in user via RLS. Returns a short, ordered
// match list for the add-medication typeahead.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });

  const { data, error } = await supabase
    .from("drugs")
    .select("id, canonical_name, controlled_schedule")
    .ilike("canonical_name", `%${q}%`)
    .order("canonical_name")
    .limit(8);

  if (error) return NextResponse.json({ results: [] }, { status: 500 });
  return NextResponse.json({ results: data ?? [] });
}
