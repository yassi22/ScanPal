"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  CreditCard,
  FileText,
  GlobeHemisphereWest,
  List,
  Pulse,
  ShieldWarning,
  SquaresFour,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notifications/notification-bell";

type DashboardShellProps = {
  children: ReactNode;
  initialUnread: number;
  needsOnboarding: boolean;
  teamName: string;
};

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: SquaresFour },
  { href: "/sites", label: "Sites", icon: GlobeHemisphereWest },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/uptime", label: "Uptime", icon: Pulse },
  { href: "/threats", label: "Threats", icon: ShieldWarning },
  { href: "/settings/team", label: "Team", icon: UsersThree },
  { href: "/billing", label: "Billing", icon: CreditCard },
] as const;

function WorkspaceNavigation({
  currentPath,
  needsOnboarding,
  onNavigate,
}: {
  currentPath: string;
  needsOnboarding: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="dashboard-sidebar-nav" aria-label="Workspace navigation">
      <span className="dashboard-sidebar-label">Workspace</span>
      {navigation.map((item) => {
        const disabled = needsOnboarding && item.href !== "/dashboard";
        const active =
          currentPath === item.href ||
          (item.href === "/sites" && currentPath.startsWith("/sites/")) ||
          (item.href === "/reports" && currentPath.startsWith("/scans/"));
        const NavIcon = item.icon;

        if (disabled) return null;

        return (
          <Link
            href={item.href}
            key={item.href}
            className={`dashboard-nav-link${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <NavIcon size={18} weight="regular" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ExistingDashboardShell({
  children,
  initialUnread,
  needsOnboarding,
  teamName,
}: DashboardShellProps) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            Scan<span className="text-brand">Pal</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            {!needsOnboarding && (
              <>
                <Link href="/dashboard" className="transition hover:text-slate-200">Dashboard</Link>
                <Link href="/sites" className="transition hover:text-slate-200">Sites</Link>
                <Link href="/reports" className="transition hover:text-slate-200">Rapporten</Link>
                <Link href="/uptime" className="transition hover:text-slate-200">Uptime</Link>
                <Link href="/threats" className="transition hover:text-slate-200">Threats</Link>
                <Link href="/settings/team" className="transition hover:text-slate-200">Team</Link>
                <Link href="/billing" className="transition hover:text-slate-200">Billing</Link>
                <NotificationBell initialUnread={initialUnread} />
              </>
            )}
            <span className="hidden text-slate-600 sm:inline">{teamName}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}

function DashboardHomeShell({
  children,
  initialUnread,
  needsOnboarding,
  teamName,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="dashboard-light-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-inner">
          <Link href="/dashboard" className="dashboard-brand" aria-label="ScanPal dashboard">
            ScanPal
          </Link>

          <div className="dashboard-topbar-actions">
            {!needsOnboarding && <NotificationBell initialUnread={initialUnread} />}
            <span className="dashboard-team-name">{teamName}</span>
            <span className="dashboard-team-avatar" aria-hidden="true">
              {teamName.slice(0, 2).toUpperCase()}
            </span>
            <div className="dashboard-logout-control">
              <LogoutButton />
            </div>
          </div>

          <button
            type="button"
            className="dashboard-mobile-toggle"
            aria-expanded={mobileOpen}
            aria-controls="dashboard-mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span>{mobileOpen ? "Close" : "Menu"}</span>
            {mobileOpen ? (
              <X size={19} weight="regular" aria-hidden="true" />
            ) : (
              <List size={21} weight="regular" aria-hidden="true" />
            )}
          </button>
        </div>

        <div
          id="dashboard-mobile-navigation"
          className={`dashboard-mobile-navigation${mobileOpen ? " is-open" : ""}`}
        >
          <WorkspaceNavigation
            currentPath={pathname}
            needsOnboarding={needsOnboarding}
            onNavigate={() => setMobileOpen(false)}
          />
          <div className="dashboard-mobile-account">
            {!needsOnboarding && <NotificationBell initialUnread={initialUnread} />}
            <span>{teamName}</span>
            <div className="dashboard-logout-control">
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard-frame">
        <aside className="dashboard-sidebar">
          <WorkspaceNavigation currentPath={pathname} needsOnboarding={needsOnboarding} />
          <div className="dashboard-sidebar-footer">
            <Pulse className="dashboard-sidebar-footer-icon" size={20} weight="regular" aria-hidden="true" />
            <div>
              <strong>Website health, made clear.</strong>
              <span>Evidence before noise.</span>
            </div>
          </div>
        </aside>

        <main className="dashboard-main">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell(props: DashboardShellProps) {
  const pathname = usePathname();

  const usesWorkspaceShell = [
    "/dashboard",
    "/sites",
    "/reports",
    "/uptime",
    "/threats",
    "/notifications",
    "/billing",
  ].some(
    (route) => pathname === route || pathname === `${route}/`,
  ) || pathname.startsWith("/sites/") || pathname.startsWith("/scans/") || pathname.startsWith("/settings");

  if (usesWorkspaceShell) {
    return <DashboardHomeShell {...props} />;
  }

  return <ExistingDashboardShell {...props} />;
}
