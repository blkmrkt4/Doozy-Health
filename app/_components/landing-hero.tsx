import type { CSSProperties } from "react";
import Link from "next/link";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "../landing.css";

// WellKept landing hero. Shared by `/` (the public front door) and `/welcome`
// (always viewable, even when signed in) so there's exactly one copy of the
// design. Tapping anywhere on the hero routes to `ctaHref`.

const display = Inter_Tight({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

// Fixed dash length so the curve draws cleanly without a client-side measure;
// comfortably exceeds the path's length, so it ends fully drawn.
const CURVE_LEN: CSSProperties = { ["--len" as string]: "1600" };

const PIP_DELAYS = ["1.5s", "1.8s", "2.1s", "2.4s", "2.7s", "3.0s"];

export function LandingHero({
  ctaHref,
  ctaLabel = "Enter WellKept",
}: {
  ctaHref: string;
  ctaLabel?: string;
}) {
  return (
    <div className={`${display.variable} ${mono.variable} wk-root`}>
      <Link href={ctaHref} className="wk-hero-link" aria-label={ctaLabel}>
        <div className="wk-main">
          <div className="wk-eyebrow">
            A ByZyB product&nbsp;&nbsp;·&nbsp;&nbsp;<b>wellkept.care</b>
          </div>
          <h1 className="wk-wordmark">
            WellKept<span className="wk-dot">.</span>
          </h1>
          <p className="wk-tagline">Your day-to-day health, well kept.</p>
          <p className="wk-sub">
            A quiet, private diary for what you take and how you feel — and for
            the people who help look after you.
          </p>
          <span className="wk-cta">
            <span className="wk-pulse" />
            Enter
          </span>
        </div>
      </Link>

      <svg
        className="wk-curve"
        viewBox="0 0 1200 300"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          className="wk-line"
          style={CURVE_LEN}
          d="M -40 248 C 150 246, 250 244, 330 175 C 392 122, 432 92, 520 100 C 620 109, 700 168, 828 198 C 968 230, 1080 220, 1240 214"
        />
        <g>
          {[180, 360, 540, 720, 900, 1080].map((cx, i) => (
            <circle
              key={cx}
              className={`wk-pip ${i === 2 ? "wk-ring" : "wk-fill"}`}
              cx={cx}
              cy={245}
              r={5}
              style={{ animationDelay: PIP_DELAYS[i] }}
            />
          ))}
        </g>
      </svg>

      <div className="wk-byline">
        <a href="https://byzyb.ai">byzyb.ai</a>
      </div>
    </div>
  );
}
