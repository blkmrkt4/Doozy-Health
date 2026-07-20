"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Toggle the per-user simple view (users.display_prefs.simple_mode).
 * Self-only by RLS (users_self_update); a caregiver setting this up on an
 * elderly owner's phone does it while signed in as them.
 */
export async function setSimpleMode(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enable = formData.get("enable") === "true";

  // Merge rather than overwrite so future prefs keys survive the toggle.
  const { data: row } = await supabase
    .from("users")
    .select("display_prefs")
    .eq("id", user.id)
    .maybeSingle();
  const current =
    row?.display_prefs && typeof row.display_prefs === "object"
      ? (row.display_prefs as Record<string, unknown>)
      : {};

  await supabase
    .from("users")
    .update({ display_prefs: { ...current, simple_mode: enable } })
    .eq("id", user.id);

  // The flag changes the root layout (html attribute + nav), so revalidate
  // the whole tree, then land the user where the new mode makes sense.
  revalidatePath("/", "layout");
  redirect(enable ? "/dashboard" : "/settings");
}
