import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova — AI Companion",
  description: "Talk naturally with a friendly animated AI companion.",
  applicationName: "Companion",
  appleWebApp: { capable: true, title: "Companion", statusBarStyle: "black-translucent" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e17" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
