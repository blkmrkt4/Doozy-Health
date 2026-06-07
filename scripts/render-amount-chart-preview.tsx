import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AmountInSystemChart } from "@/app/_components/amount-in-system-chart";
import { writeFileSync } from "node:fs";
import type { DrugPK, DoseEvent, PrescribedRegimen } from "@/lib/pk/amountInSystem";

// One-off preview generator for the amount-in-system chart revision (v2).
// Renders the two testosterone acceptance cases to a self-contained HTML file
// (theme tokens inlined) so the rounded depot waves, date axis, Today line, and
// the regime-aware narrative can be eyeballed. Run with:
//   npx vite-node scripts/render-amount-chart-preview.tsx

const NOW = new Date(2026, 5, 7); // today · Jun 7 (matches the reference anchor)
const LEFT = 56; // days of history before today
const RIGHT = 42; // days of projection after today

function repeating(perDose: number, intervalDays: number): DoseEvent[] {
  const ev: DoseEvent[] = [];
  for (let t = 0; t <= LEFT + RIGHT + 1e-6; t += intervalDays) {
    ev.push({ t: +t.toFixed(2), amount: perDose, taken: true });
  }
  return ev;
}

const TESTOSTERONE: DrugPK = {
  name: "Testosterone cypionate",
  route: "intramuscular",
  unit: "mg",
  halfLifeDays: 8,
  halfLifeRangeDays: [7, 9],
  isLinear: true,
  model: "amount_in_system",
  provenance: "curated",
};

const ACCENT = "#1D9E75";

const accumulating = {
  drug: TESTOSTERONE,
  doses: repeating(67, 7 / 3),
  prescribed: {
    perDose: 67,
    intervalDays: 7 / 3,
    perPeriodDose: 200,
    perPeriodLabel: "200 mg per week (what goes in)",
  } as PrescribedRegimen,
  identityColor: ACCENT,
  nowDays: LEFT,
  nowDate: NOW,
};

const clearsBetween = {
  drug: TESTOSTERONE,
  doses: repeating(50, 28),
  prescribed: { perDose: 50, intervalDays: 28 } as PrescribedRegimen,
  identityColor: ACCENT,
  nowDays: LEFT,
  nowDate: NOW,
};

const card = (
  name: string,
  sub: string,
  tag: string,
  props: Parameters<typeof AmountInSystemChart>[0]
) => `
  <div class="cd">
    <div class="hd">
      <div><div class="nm">${name}</div><div class="sub">${sub}</div></div>
      <div class="tag">${tag}</div>
    </div>
    ${renderToStaticMarkup(h(AmountInSystemChart, props))}
  </div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doozy — Amount-in-System chart (revision v2 preview)</title>
<style>
  :root{
    --color-paper:#16150f; --color-ink:#16150f; --color-muted:#5b5950;
    --color-faint:#908d84; --color-line:#e3e1da; --color-surface:#ffffff;
    --bg:#faf9f6; --card:#ffffff; --border:#e3e1da;
    font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  @media (prefers-color-scheme:dark){
    :root{ --color-paper:#f0efe9; --color-ink:#f0efe9; --color-muted:#b6b3aa;
           --color-faint:#86837b; --color-line:#2a2a27; --color-surface:#161614;
           --bg:#101010; --card:#161614; --border:#2c2b27; }
  }
  body{margin:0;background:var(--bg);color:var(--color-ink);padding:24px 14px;}
  .wrap{max-width:680px;margin:0 auto;}
  .cd{background:var(--card);border:0.5px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:14px;}
  .hd{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;}
  .nm{font-size:14px;font-weight:600;}
  .sub{font-size:12px;color:var(--color-muted);}
  .tag{font-size:12px;color:var(--color-faint);margin-left:auto;white-space:nowrap;}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);}
</style></head>
<body><div class="wrap">
${card("Testosterone cypionate", "67 mg every ~2.3 days (≈200 mg/week) · IM", "accumulates → steady range", accumulating)}
${card("Testosterone cypionate", "50 mg every 4 weeks · IM", "clears between doses", clearsBetween)}
</div></body></html>`;

writeFileSync("amount-in-system-chart.preview.html", html);
console.log("wrote amount-in-system-chart.preview.html");
