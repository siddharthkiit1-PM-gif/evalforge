import Link from 'next/link';

export default function Nav() {
  return (
    <header
      role="banner"
      className="sticky top-0 z-10 h-12 border-b border-border bg-bg/80 backdrop-blur"
    >
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
        <span className="font-display text-base text-fg">EvalForge</span>
        {/* Update href to your actual profile link before deploying */}
        <Link
          href="#"
          className="font-body text-sm text-muted hover:text-fg transition-colors"
        >
          Built by Siddharth
        </Link>
      </div>
    </header>
  );
}
