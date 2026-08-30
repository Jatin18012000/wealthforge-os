"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The screens from docs/03_INFORMATION_ARCHITECTURE.md. Those not yet built
 * are deliberately absent rather than present-and-empty: a link to a screen
 * that does nothing is a promise the app has not kept.
 */
const LINKS = [
  { href: "/", label: "Command Center" },
  { href: "/budget", label: "Budget" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/goals", label: "Goals" },
  { href: "/liabilities", label: "Liabilities" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
  { href: "/market", label: "Market" },
  { href: "/data-center", label: "Data Center" },
  { href: "/ai-analyst", label: "AI Analyst" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar__nav" aria-label="Main">
      {LINKS.map((link) => {
        const isCurrent =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="sidebar__link"
            aria-current={isCurrent ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
