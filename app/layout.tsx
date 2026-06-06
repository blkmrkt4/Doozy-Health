import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DisclaimerFooter } from "./_components/disclaimer-footer";

export const metadata: Metadata = {
  title: "WellKept",
  description:
    "A wellness diary tool for personal medication tracking and how you feel.",
  applicationName: "WellKept",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WellKept",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Stop iOS turning dose amounts / times into tap-to-call links.
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Edge-to-edge on iOS without locking out accessibility pinch-zoom.
  viewportFit: "cover",
  // PWA chrome follows the OS preference; the in-app toggle overrides the page.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Applied before first paint to avoid a flash of the wrong theme: honour the
// stored choice, else fall back to the OS preference.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-ink text-paper antialiased">
        {/* The disclaimer footer is global so it cannot be omitted from any
            screen — PRD §6.1 requires it everywhere. */}
        <div className="flex-1">{children}</div>
        <DisclaimerFooter />
      </body>
    </html>
  );
}
