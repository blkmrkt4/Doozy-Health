"use client";

// Client-side "Save as PDF" for the Health snapshot. Calls window.print(), so
// the browser's own print engine renders the already-styled report (using the
// @media print rules in report.css) and the OS dialog offers Save as PDF or a
// printer. No server-side PDF/Chromium — that's what failed on Vercel's hobby
// plan; here the host does nothing but serve the page.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="report-print-btn"
      title="Opens your browser's print dialog — choose “Save as PDF” or a printer"
    >
      Save as PDF
    </button>
  );
}
