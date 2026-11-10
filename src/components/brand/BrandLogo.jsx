import React from 'react';

// WeaHR brand mark: three teammates forming a "W" above a coffee saucer.
// Kept inline so the logo renders instantly and stays identical everywhere.
export function BrandMark({ size = 40, className = '' }) {
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="WeaHR"
    >
      <defs>
        <linearGradient id="wea-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3a2014" />
          <stop offset="100%" stopColor="#7a4424" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill="url(#wea-mark-bg)" />
      <path d="M10 76 Q50 90 90 76" stroke="#e39a4b" strokeWidth="5" fill="none" strokeLinecap="round" />
      <polyline points="20,66 31,32 50,56 69,32 80,66" stroke="#f7ebdd" strokeWidth="9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="31" cy="21" r="7" fill="#e39a4b" />
      <circle cx="50" cy="44" r="7" fill="#e39a4b" />
      <circle cx="69" cy="21" r="7" fill="#e39a4b" />
    </svg>
  );
}

// Logo + wordmark. `tone="light"` is for dark backgrounds.
export function BrandLogo({ size = 40, tone = 'dark', tagline = '' }) {
  return (
    <span className={`brand-logo brand-logo-${tone}`}>
      <BrandMark size={size} />
      <span className="brand-logo-text">
        <span className="brand-wordmark">Wea<b>HR</b></span>
        {tagline && <span className="brand-tagline">{tagline}</span>}
      </span>
    </span>
  );
}

export default BrandLogo;
