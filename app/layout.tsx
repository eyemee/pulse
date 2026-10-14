import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// One family throughout: the globe carries the personality, the type stays
// quiet and legible over it.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pulse",
  description:
    "Strangers lit up across the night side of the world. Tap a light to talk. No accounts, nothing stored.",
};

export const viewport: Viewport = {
  themeColor: "#081128",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
