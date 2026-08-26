import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <Link href="/" className="auth-brand" aria-label="ScanPal home">
          <BrandLogo />
        </Link>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
