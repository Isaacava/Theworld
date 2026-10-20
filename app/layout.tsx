import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "THE WORLD — Local conversations, connected to places",
  description:
    "Explore real places, discover local conversations, and contribute when you are nearby.",
  applicationName: "THE WORLD",
  keywords: [
    "THE WORLD",
    "social map",
    "interactive globe",
    "local communities",
    "place discovery",
  ],
  openGraph: {
    title: "THE WORLD",
    description: "Find a place, meet its people, and join local conversations.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F4EF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
