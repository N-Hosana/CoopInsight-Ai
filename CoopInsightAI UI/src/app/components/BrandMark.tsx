/**
 * The CoopInsightAI mark — three overlapping circles, members joining
 * together, with a gold point where they meet. The same mark the PDF engine
 * draws on every document (CoopInsightAI Backend/src/services/pdf.ts), so a
 * report on screen and on paper look like they came from the same place.
 */
export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  const r = 7.2;
  const d = 4.7;
  const points = [-90, 30, 150].map((a) => {
    const rad = (a * Math.PI) / 180;
    return [18 + d * Math.cos(rad), 18.7 + d * Math.sin(rad)];
  });
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" className={className} aria-label="CoopInsightAI" role="img">
      <rect width="36" height="36" rx="8" fill="#2D6A4F" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="none" stroke="#FFFFFF" strokeWidth="1.6" opacity="0.92" />
      ))}
      <circle cx="18" cy="18.7" r="2.7" fill="#D4A574" />
    </svg>
  );
}

/** Mark and wordmark together, for document headers. */
export function BrandLockup({ subtitle = "Cooperative management and oversight platform" }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={38} />
      <div>
        <p className="text-lg font-bold leading-tight text-[#1B4332]">CoopInsightAI</p>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}
