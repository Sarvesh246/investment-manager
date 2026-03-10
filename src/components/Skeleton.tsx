export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ''}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-text">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="skeleton-text__line" />
      ))}
    </div>
  );
}
