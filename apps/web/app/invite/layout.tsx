import Link from "next/link";

export default function InviteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <Link href="/" className="auth-brand" aria-label="ScanPal home">
          <span className="auth-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          ScanPal
        </Link>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
