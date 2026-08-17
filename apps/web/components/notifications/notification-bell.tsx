"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const POLL_INTERVAL_MS = 60000;

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=true&limit=1");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.unread === "number") setUnread(data.unread);
    } catch {
      // netwerkfout — badge ongewijzigd laten
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0 ? `Meldingen, ${unread} ongelezen` : "Meldingen"
      }
      className="relative inline-flex items-center gap-1.5 transition hover:text-slate-200"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
        />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-2 -top-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      <span className="hidden lg:inline">Meldingen</span>
    </Link>
  );
}
