import type { Domain } from '@/lib/types';

const STYLES: Record<Domain, { label: string; className: string }> = {
  legal: {
    label: 'Legal',
    className: 'bg-elevated border-border text-fg',
  },
  sales: {
    label: 'Sales',
    className: 'bg-elevated border-border text-fg',
  },
  healthcare: {
    label: 'Healthcare',
    className: 'bg-elevated border-border text-fg',
  },
  general: {
    label: 'General',
    className: 'bg-elevated border-border text-muted',
  },
};

export default function DomainBadge({ domain }: { domain: Domain }) {
  const style = STYLES[domain];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs ${style.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {style.label}
    </span>
  );
}
