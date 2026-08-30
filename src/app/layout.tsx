import type { Metadata } from "next";
import { Nav } from "../components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "WEALTHFORGE OS",
  description: "Local-first personal financial operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <header className="sidebar">
            <p className="sidebar__brand">Wealthforge OS</p>
            <Nav />
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
