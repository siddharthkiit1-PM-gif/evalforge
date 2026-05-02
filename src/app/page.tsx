'use client';

import SpecForm from '@/components/SpecForm';

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl text-fg">EvalForge</h1>
        <p className="font-body text-base text-muted max-w-2xl">
          Paste an AI feature spec. Get a domain-aware eval suite that runs.
        </p>
      </header>

      <SpecForm
        onSubmit={(spec) => {
          // Plan B replaces this with a call to /api/parse-spec.
          console.log('submit', spec);
        }}
      />
    </div>
  );
}
