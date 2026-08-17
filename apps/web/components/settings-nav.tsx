"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/settings/profile", label: "Profiel" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/notifications", label: "Notificaties" },
  { href: "/settings/api-keys", label: "API-keys" },
  { href: "/settings/webhooks", label: "Webhooks" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="mt-6 flex flex-wrap gap-2 border-b border-slate-800 pb-4">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "bg-slate-800 font-medium text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
