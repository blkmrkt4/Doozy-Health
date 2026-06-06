import { ThemeToggle } from "./theme-toggle";

/**
 * Regulatory disclaimer footer — PRD §6.1. The exact wording is mandated and
 * must appear on every screen and document. Do not paraphrase or soften it.
 * The theme switch lives here so it's reachable from every screen.
 */
export const DISCLAIMER_TEXT =
  "Doozy Health is a wellness tool. It is not a medical device and does not provide medical advice. Consult your doctor.";

export function DisclaimerFooter() {
  return (
    <footer className="border-t border-line px-6 py-4">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-center text-xs leading-relaxed text-faint sm:text-left">
          {DISCLAIMER_TEXT}
        </p>
        <ThemeToggle />
      </div>
    </footer>
  );
}
