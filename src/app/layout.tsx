import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WEALTHFORGE OS",
  description: "Local-first personal financial operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
