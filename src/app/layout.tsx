import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RECLAIM — Autonomous Payment Recovery",
  description:
    "A safety-first autonomous payment recovery engine.",
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