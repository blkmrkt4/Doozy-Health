import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DisclaimerFooter } from "./_components/disclaimer-footer";

export const metadata: Metadata = {
  title: "Doozy Health",
  description:
    "A wellness diary tool for personal medication tracking and how you feel.",
  applicationName: "Doozy Health",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Doozy Health",
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
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body className="flex min-h-screen flex-col bg-ink text-paper antialiased">
        {/* The disclaimer footer is global so it cannot be omitted from any
            screen — PRD §6.1 requires it everywhere. */}
        <div className="flex-1">{children}</div>
        <DisclaimerFooter />
      </body>
    </html>
  );
}
