import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HyperFrames on Vercel",
  description:
    "Preview HyperFrames compositions and render MP4s on Vercel — powered by Vercel Sandbox.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
