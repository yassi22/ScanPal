"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/api-keys", label: "API keys" },
  { href: "/settings/webhooks", label: "Webhooks" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="settings-subnav" aria-label="Settings sections">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
