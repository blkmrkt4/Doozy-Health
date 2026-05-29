/**
 * Regulatory disclaimer footer — PRD §6.1. The exact wording is mandated and
 * must appear on every screen and document. Do not paraphrase or soften it.
 */
export const DISCLAIMER_TEXT =
  "Doozy Health is a wellness tool. It is not a medical device and does not provide medical advice. Consult your doctor.";

export function DisclaimerFooter() {
  return (
    <footer className="border-t border-line px-6 py-4">
      <p className="mx-auto max-w-5xl text-center text-xs leading-relaxed text-faint">
        {DISCLAIMER_TEXT}
      </p>
    </footer>
  );
}
