import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LandingHero } from "@/app/_components/landing-hero";

// The landing, always viewable — including when signed in (reached via the
// wordmark). Unlike `/`, it never redirects; the hero just routes to the right
// place for who's looking at it.

export const metadata: Metadata = {
  title: "WellKept",
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <LandingHero
      ctaHref={user ? "/dashboard" : "/login"}
      ctaLabel={user ? "Enter WellKept" : "Sign in to WellKept"}
    />
  );
}
