import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Admin gate (PRD §14.1). Returns the authenticated admin user or calls
// notFound() — non-admins see a 404, never a 403.

export async function requireSystemAdmin(): Promise<{
  id: string;
  email: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) notFound();

  const { data: profile } = await supabase
    .from("users")
    .select("is_system_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_system_admin) notFound();

  return { id: user.id, email: user.email! };
}
