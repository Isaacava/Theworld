import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "THE WORLD — Explore the places that connect us",
  description:
    "Explore the real Earth, discover place-based communities, and see the world through the people connected to its places.",
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
    description: "Every place has a story. Explore the world through its communities.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07111b",
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
