"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePatient, setActivePatient } from "@/lib/active-patient";

function str(fd: FormData, key: string): string {
  return (fd.get(key) as string | null)?.trim() ?? "";
}

function fail(message: string): never {
  redirect(`/settings/caregivers?error=${encodeURIComponent(message)}`);
}

// ── Invite ─────────────────────────────────────────────────────────────────

/**
 * Invite a caregiver or viewer to the active patient (PRD §4.5).
 * Creates a patient_memberships row. If the user doesn't exist yet,
 * creates a placeholder that will be linked when they sign up.
 */
export async function inviteCaregiver(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") {
    fail("Only the patient owner can invite caregivers.");
  }

  const email = str(formData, "email").toLowerCase();
  if (!email || !email.includes("@")) fail("Enter a valid email address.");

  const role = str(formData, "role");
  if (role !== "caregiver" && role !== "viewer") fail("Choose a valid role.");

  // Look up the invitee by email.
  const admin = createAdminClient();
  const { data: inviteeProfile } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!inviteeProfile) {
    fail(
      `No account found for ${email}. They need to sign up first, then you can invite them.`
    );
  }

  // Check for existing membership.
  const { data: existing } = await supabase
    .from("patient_memberships")
    .select("id")
    .eq("patient_id", active.id)
    .eq("user_id", inviteeProfile.id)
    .maybeSingle();

  if (existing) fail(`${email} is already a member.`);

  // Create the membership (RLS: owner can insert).
  const { error } = await supabase.from("patient_memberships").insert({
    patient_id: active.id,
    user_id: inviteeProfile.id,
    role,
    invited_by: user.id,
    // accepted_at left null — the invitee must accept.
  });

  if (error) fail(`Invite failed: ${error.message}`);

  revalidatePath("/settings/caregivers");
  redirect("/settings/caregivers?success=Invite+sent");
}

// ── Accept invite ──────────────────────────────────────────────────────────

/**
 * Accept a pending invite (sets accepted_at on the membership).
 */
export async function acceptInvite(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membershipId = str(formData, "membership_id");
  if (!membershipId) redirect("/dashboard");

  // The user can only update their own pending memberships.
  const { error } = await supabase
    .from("patient_memberships")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", membershipId)
    .eq("user_id", user.id)
    .is("accepted_at", null);

  if (error) redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Decline a pending invite (deletes the membership).
 */
export async function declineInvite(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membershipId = str(formData, "membership_id");
  if (!membershipId) redirect("/dashboard");

  // Users can delete their own pending membership to decline.
  // This requires a brief policy or service-role. For now use admin client
  // since the memberships_owner_delete policy only covers owners.
  const admin = createAdminClient();
  await admin
    .from("patient_memberships")
    .delete()
    .eq("id", membershipId)
    .eq("user_id", user.id)
    .is("accepted_at", null);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// ── Remove membership ──────────────────────────────────────────────────────

/**
 * Remove a member from the active patient (owner only).
 */
export async function removeMembership(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") {
    fail("Only the patient owner can remove members.");
  }

  const membershipId = str(formData, "membership_id");
  if (!membershipId) fail("Missing membership.");

  // Prevent removing own membership.
  const { data: target } = await supabase
    .from("patient_memberships")
    .select("user_id")
    .eq("id", membershipId)
    .single();

  if (target?.user_id === user.id) {
    fail("You cannot remove yourself.");
  }

  const { error } = await supabase
    .from("patient_memberships")
    .delete()
    .eq("id", membershipId);

  if (error) fail(`Could not remove: ${error.message}`);

  revalidatePath("/settings/caregivers");
  redirect("/settings/caregivers?success=Member+removed");
}

// ── Change role ────────────────────────────────────────────────────────────

export async function changeRole(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") {
    fail("Only the patient owner can change roles.");
  }

  const membershipId = str(formData, "membership_id");
  const newRole = str(formData, "role");
  if (!membershipId) fail("Missing membership.");
  if (newRole !== "caregiver" && newRole !== "viewer") fail("Invalid role.");

  const { error } = await supabase
    .from("patient_memberships")
    .update({ role: newRole })
    .eq("id", membershipId);

  if (error) fail(`Could not change role: ${error.message}`);

  revalidatePath("/settings/caregivers");
  redirect("/settings/caregivers");
}

// ── Switch patient ─────────────────────────────────────────────────────────

export async function switchPatient(formData: FormData) {
  const supabase = await createClient();
  const patientId = str(formData, "patient_id");
  if (!patientId) redirect("/dashboard");

  await setActivePatient(supabase, patientId);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
