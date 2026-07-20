import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user UI preferences stored in users.display_prefs (jsonb). The column
// defaults to {} and older rows may hold anything, so parse defensively and
// treat every unknown shape as "off".

export type DisplayPrefs = {
  simpleMode: boolean;
};

export function parseDisplayPrefs(raw: unknown): DisplayPrefs {
  const prefs: DisplayPrefs = { simpleMode: false };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    prefs.simpleMode = obj.simple_mode === true;
  }
  return prefs;
}

export async function getDisplayPrefs(
  supabase: SupabaseClient,
  userId: string
): Promise<DisplayPrefs> {
  const { data } = await supabase
    .from("users")
    .select("display_prefs")
    .eq("id", userId)
    .maybeSingle();
  return parseDisplayPrefs(data?.display_prefs);
}
