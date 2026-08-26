export function BrandLogo() {
  return (
    <span className="brand-logo">
      <svg
        className="brand-logo-mark"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect width="24" height="24" rx="6.5" fill="#17212B" />
        <path
          d="M9 5.75H6.75a1 1 0 0 0-1 1V9M15 5.75h2.25a1 1 0 0 1 1 1V9M9 18.25H6.75a1 1 0 0 1-1-1V15M15 18.25h2.25a1 1 0 0 0 1-1V15"
          stroke="#F7FAFC"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="m8.75 12.35 2.1 2.05 4.45-4.55"
          stroke="#68C2B8"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="brand-wordmark">
        <span>Scan</span>
        <span className="brand-wordmark-pal">Pal</span>
      </span>
    </span>
  );
}
