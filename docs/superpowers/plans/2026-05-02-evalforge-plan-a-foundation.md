# EvalForge Plan A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the EvalForge UI shell — design tokens, fonts, Nav/Footer layout, hero, and the spec-input form (textarea + 3 example chips + submit button) — with no API integration yet, fully covered by Vitest + RTL component tests.

**Architecture:** Next.js 16 App Router. Server `layout.tsx` wires fonts, Nav, Footer, and a centered max-w container. Server `page.tsx` renders the hero text and a `<SpecForm/>` client component. `<SpecForm/>` owns input state via `useState` and calls a placeholder `onSubmit` (logs to console for now; replaced by real API call in Plan B). Tailwind v4 design tokens live in `globals.css` under `@theme` (semantically equivalent to the source spec's `tailwind.config.ts` v3 syntax).

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript 5, Tailwind v4 (via `@tailwindcss/postcss`), `next/font/google` (Space Mono, IBM Plex Sans, JetBrains Mono), Vitest, @testing-library/react, @testing-library/user-event, jsdom.

**Spec reference:** `docs/superpowers/specs/2026-05-02-evalforge-design.md` (covers Phases 0-3 of the source build plan).

---

## File map

**Create:**
- `vitest.config.ts` — Vitest + @vitejs/plugin-react config, jsdom env, `@/` alias
- `vitest.setup.ts` — `@testing-library/jest-dom/vitest` import
- `.env.local.example` — placeholder for `GEMINI_API_KEY`
- `src/lib/examples.ts` — 3 example specs as exported `EXAMPLES` array
- `src/components/Nav.tsx` — sticky top, brand + byline link, 48px tall
- `src/components/Footer.tsx` — minimal, top border
- `src/components/SpecInput.tsx` — controlled textarea, monospace, auto-resize, value/onChange/disabled props
- `src/components/SpecForm.tsx` — `'use client'`, holds spec state, renders chips + SpecInput + submit button
- `src/components/__tests__/Nav.test.tsx`
- `src/components/__tests__/Footer.test.tsx`
- `src/components/__tests__/SpecInput.test.tsx`
- `src/components/__tests__/SpecForm.test.tsx`

**Modify:**
- `package.json` — add Vitest + RTL devDeps + `test` script
- `tsconfig.json` — add `vitest/globals` to `types`
- `src/app/globals.css` — replace Geist tokens with EvalForge `@theme` block
- `src/app/layout.tsx` — replace Geist fonts with Space Mono + IBM Plex Sans + JetBrains Mono; wrap children with Nav/Footer/container; set dark `bg-bg`
- `src/app/page.tsx` — replace scaffold with `<Hero/>` + `<SpecForm/>`

---

## Conventions

- **Tailwind v4 token names** (used by every task — keep consistent):
  - Backgrounds: `bg-bg` (#0A0A0B canvas), `bg-surface` (#141415), `bg-elevated` (#1C1C1E), `bg-pass`, `bg-fail`
  - Borders: `border-border` (#27272A), `border-border-hover` (#3F3F46)
  - Text: `text-fg` (#FAFAFA primary), `text-muted` (#71717A), `text-dim` (#52525B)
  - Accents: `accent` (#818CF8), `success`, `failure`, `warning`
  - Fonts: `font-display` (Space Mono), `font-body` (IBM Plex Sans), `font-mono` (JetBrains Mono)
- **Test file co-location:** `src/components/__tests__/<Name>.test.tsx` next to source.
- **Imports:** use `@/` alias (configured in tsconfig + vitest.config).
- **Commits:** one per task. Conventional Commits (`feat:`, `chore:`, `test:`).
- **Run tests after every implementation step.** `npm test -- --run` for one-shot, `npm test` for watch (we always use `--run` in this plan).

---

## Task 1: Bootstrap Vitest + RTL

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `tsconfig.json`
- Create: `src/lib/__tests__/sanity.test.ts`

- [ ] **Step 1.1: Install dev dependencies**

```bash
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom jsdom
```

Expected: dependencies added, no errors. `package.json` `devDependencies` should now include all 7 packages.

- [ ] **Step 1.2: Add `test` script**

Edit `package.json` `scripts` block to add:

```json
"test": "vitest",
"test:run": "vitest run"
```

Final `scripts` block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest",
  "test:run": "vitest run"
}
```

- [ ] **Step 1.3: Create `vitest.config.ts`**

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 1.4: Create `vitest.setup.ts`**

Create `vitest.setup.ts` at the repo root:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 1.5: Add Vitest globals to `tsconfig.json`**

Edit `tsconfig.json` `compilerOptions` to add `types`:

```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

Insert it after `"jsx": "react-jsx",`. The `compilerOptions` block becomes:

```json
"compilerOptions": {
  "target": "ES2017",
  "lib": ["dom", "dom.iterable", "esnext"],
  "allowJs": true,
  "skipLibCheck": true,
  "strict": true,
  "noEmit": true,
  "esModuleInterop": true,
  "module": "esnext",
  "moduleResolution": "bundler",
  "resolveJsonModule": true,
  "isolatedModules": true,
  "jsx": "react-jsx",
  "types": ["vitest/globals", "@testing-library/jest-dom"],
  "incremental": true,
  "plugins": [{ "name": "next" }],
  "paths": { "@/*": ["./src/*"] }
}
```

- [ ] **Step 1.6: Write a sanity test**

Create `src/lib/__tests__/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 1.7: Run the sanity test**

Run: `npm run test:run`

Expected: 1 test passes, 0 fail. Output includes `Test Files  1 passed (1)` and `Tests  1 passed (1)`.

- [ ] **Step 1.8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts tsconfig.json src/lib/__tests__/sanity.test.ts
git commit -m "chore: bootstrap vitest + react testing library"
```

---

## Task 2: Design tokens (Tailwind v4 `@theme`)

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 2.1: Read the Next.js 16 CSS guide for context (optional but recommended)**

Skim `node_modules/next/dist/docs/01-app/02-guides/css-in-js.md` (and any sibling file mentioning Tailwind v4) to confirm the `@theme` directive is the supported approach for design tokens with `@tailwindcss/postcss`. We'll use it because the existing scaffold already does (`globals.css` lines 8-13).

- [ ] **Step 2.2: Replace `globals.css`**

Replace the **entire** contents of `src/app/globals.css` with:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0A0A0B;
  --color-surface: #141415;
  --color-elevated: #1C1C1E;

  --color-border: #27272A;
  --color-border-hover: #3F3F46;

  --color-fg: #FAFAFA;
  --color-muted: #71717A;
  --color-dim: #52525B;

  --color-accent: #818CF8;
  --color-success: #22C55E;
  --color-failure: #EF4444;
  --color-warning: #F59E0B;

  --color-pass: rgba(34, 197, 94, 0.08);
  --color-fail: rgba(239, 68, 68, 0.08);

  --font-display: var(--font-space-mono), monospace;
  --font-body: var(--font-ibm-plex-sans), sans-serif;
  --font-mono: var(--font-jetbrains-mono), monospace;
}

html, body {
  background-color: var(--color-bg);
  color: var(--color-fg);
}

body {
  font-family: var(--font-body);
}
```

Notes:
- `--font-space-mono`, `--font-ibm-plex-sans`, `--font-jetbrains-mono` are defined by `next/font/google` calls in `layout.tsx` (Task 3) and propagated via the `<html>` className.
- The class names exposed to Tailwind are derived from token suffixes: `bg-bg`, `bg-surface`, `bg-elevated`, `bg-pass`, `bg-fail`, `border-border`, `border-border-hover`, `text-fg`, `text-muted`, `text-dim`, `text-accent`, `bg-accent`, `text-success`, `text-failure`, `text-warning`, `font-display`, `font-body`, `font-mono`.

- [ ] **Step 2.3: Verify build still succeeds**

Run: `npm run build`

Expected: build completes without errors. Tailwind compiles the new tokens. The fonts won't be visible yet (set up in Task 3) but CSS shouldn't break.

If the build fails referencing missing `--font-*` variables: that's expected at runtime, not build time. Build should still pass since `@theme` accepts undefined `var()` references.

- [ ] **Step 2.4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add evalforge design tokens via tailwind v4 @theme"
```

---

## Task 3: Wire fonts in `layout.tsx`

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 3.1: Read the Next.js 16 fonts guide**

Skim `node_modules/next/dist/docs/01-app/02-guides/fonts.md` (or whatever the current filename is — check the `02-guides/` listing for "font"). Confirm `next/font/google` with `variable` option is still the recommended pattern. The existing layout already uses this pattern with Geist; we mirror it.

- [ ] **Step 3.2: Replace fonts in `layout.tsx`**

Replace the **entire** contents of `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Space_Mono, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "EvalForge",
  description: "Paste an AI feature spec. Get a domain-aware eval suite that runs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${spaceMono.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-fg font-body">
        {children}
      </body>
    </html>
  );
}
```

(Nav and Footer get added in Task 6 — keep this step focused on fonts only.)

- [ ] **Step 3.3: Smoke-test in dev server**

Run: `npm run dev`

In a browser, open `http://localhost:3000`. Open DevTools → Elements → inspect `<html>`: should have three `--font-*` CSS variables defined inline (look at computed styles). Body text should render in IBM Plex Sans.

Stop the dev server (Ctrl+C).

- [ ] **Step 3.4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: load space mono, ibm plex sans, jetbrains mono via next/font"
```

---

## Task 4: Nav component (TDD)

**Files:**
- Create: `src/components/Nav.tsx`
- Create: `src/components/__tests__/Nav.test.tsx`

- [ ] **Step 4.1: Write the failing test**

Create `src/components/__tests__/Nav.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Nav from '@/components/Nav';

describe('Nav', () => {
  it('renders the EvalForge brand', () => {
    render(<Nav />);
    expect(screen.getByText('EvalForge')).toBeInTheDocument();
  });

  it('renders a "Built by Siddharth" link', () => {
    render(<Nav />);
    const link = screen.getByRole('link', { name: /built by siddharth/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href');
  });

  it('renders as a banner landmark', () => {
    render(<Nav />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/__tests__/Nav.test.tsx`

Expected: FAIL with "Cannot find module '@/components/Nav'" or similar.

- [ ] **Step 4.3: Implement `Nav.tsx`**

Create `src/components/Nav.tsx`:

```tsx
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
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/__tests__/Nav.test.tsx`

Expected: 3 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/components/Nav.tsx src/components/__tests__/Nav.test.tsx
git commit -m "feat: add Nav component"
```

---

## Task 5: Footer component (TDD)

**Files:**
- Create: `src/components/Footer.tsx`
- Create: `src/components/__tests__/Footer.test.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `src/components/__tests__/Footer.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from '@/components/Footer';

describe('Footer', () => {
  it('renders as a contentinfo landmark', () => {
    render(<Footer />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('renders the EvalForge byline', () => {
    render(<Footer />);
    expect(screen.getByText(/evalforge/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/__tests__/Footer.test.tsx`

Expected: FAIL with "Cannot find module '@/components/Footer'".

- [ ] **Step 5.3: Implement `Footer.tsx`**

Create `src/components/Footer.tsx`:

```tsx
export default function Footer() {
  return (
    <footer
      role="contentinfo"
      className="border-t border-border mt-auto"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4 text-xs text-dim">
        <span className="font-display">EvalForge</span>
        <span>Gemini 2.5 Flash · Demo</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/__tests__/Footer.test.tsx`

Expected: 2 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/Footer.tsx src/components/__tests__/Footer.test.tsx
git commit -m "feat: add Footer component"
```

---

## Task 6: Wire Nav + Footer + container into `layout.tsx`

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 6.1: Add Nav, container, Footer**

Edit `src/app/layout.tsx`. Replace the `<body>` block with:

```tsx
<body className="min-h-full flex flex-col bg-bg text-fg font-body">
  <Nav />
  <main className="flex-1 mx-auto w-full max-w-[1200px] px-6 py-12">
    {children}
  </main>
  <Footer />
</body>
```

Add the imports near the top, after the font imports:

```tsx
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
```

- [ ] **Step 6.2: Smoke-test in dev server**

Run: `npm run dev`. Open `http://localhost:3000`. Verify:
- Black background.
- Sticky header with "EvalForge" left and "Built by Siddharth" right.
- Page content area in the middle (still showing the create-next-app default scaffold — that's fine; replaced in Task 9).
- Footer at the bottom with "EvalForge" and "Gemini 2.5 Flash · Demo".

Stop dev server.

- [ ] **Step 6.3: Run all tests**

Run: `npm run test:run`

Expected: all tests so far pass (sanity + Nav + Footer = 6 tests).

- [ ] **Step 6.4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: wire Nav, Footer, and centered container into root layout"
```

---

## Task 7: SpecInput component (TDD)

**Files:**
- Create: `src/components/SpecInput.tsx`
- Create: `src/components/__tests__/SpecInput.test.tsx`

`SpecInput` is a presentational, controlled textarea. Auto-resize is a nice-to-have but jsdom can't compute layout, so we'll implement auto-resize via `scrollHeight` in a `useEffect` and only test the controlled-input behaviour.

- [ ] **Step 7.1: Write the failing test**

Create `src/components/__tests__/SpecInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpecInput from '@/components/SpecInput';

describe('SpecInput', () => {
  it('renders a textarea with the provided value', () => {
    render(<SpecInput value="hello world" onChange={() => {}} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('hello world');
  });

  it('calls onChange when the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SpecInput value="" onChange={onChange} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toBe('hi');
  });

  it('disables the textarea when disabled prop is true', () => {
    render(<SpecInput value="" onChange={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('shows the placeholder text', () => {
    render(<SpecInput value="" onChange={() => {}} />);
    expect(
      screen.getByPlaceholderText(/paste an ai feature spec/i)
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/__tests__/SpecInput.test.tsx`

Expected: FAIL with "Cannot find module '@/components/SpecInput'".

- [ ] **Step 7.3: Implement `SpecInput.tsx`**

Create `src/components/SpecInput.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export default function SpecInput({ value, onChange, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Paste an AI feature spec…"
      rows={6}
      className="w-full resize-none rounded-md border border-border bg-surface px-4 py-3 font-mono text-sm text-fg placeholder:text-dim focus:border-border-hover focus:outline-none disabled:opacity-50"
    />
  );
}
```

- [ ] **Step 7.4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/__tests__/SpecInput.test.tsx`

Expected: 4 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/SpecInput.tsx src/components/__tests__/SpecInput.test.tsx
git commit -m "feat: add SpecInput controlled textarea"
```

---

## Task 8: Example specs data file

**Files:**
- Create: `src/lib/examples.ts`

- [ ] **Step 8.1: Create `examples.ts`**

Create `src/lib/examples.ts`:

```ts
export type Example = {
  id: 'legal' | 'sales' | 'healthcare';
  label: string;
  spec: string;
};

export const EXAMPLES: Example[] = [
  {
    id: 'legal',
    label: 'Legal',
    spec: 'AI reads a signed contract PDF and extracts all obligation clauses — payment terms, delivery deadlines, termination notice windows, auto-renewal triggers, SLA commitments. Output: structured table with clause text, obligation type, responsible party, due date, page/section reference.',
  },
  {
    id: 'sales',
    label: 'Sales',
    spec: "AI drafts a personalized cold email to a B2B prospect. Input: prospect's LinkedIn profile and company website. Email must reference one specific detail from their profile, be under 150 words, include one relevant case study, and avoid unverifiable claims about the prospect's company.",
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    spec: "AI reads a physician's clinical note and flags missing elements required for CPT/ICD-10 billing compliance. Must identify: missing diagnosis codes, insufficient time documentation, absent medical necessity justification, procedures mentioned but not coded.",
  },
];
```

(No test for pure data.)

- [ ] **Step 8.2: Commit**

```bash
git add src/lib/examples.ts
git commit -m "feat: add example spec data for legal, sales, healthcare"
```

---

## Task 9: SpecForm component (TDD)

**Files:**
- Create: `src/components/SpecForm.tsx`
- Create: `src/components/__tests__/SpecForm.test.tsx`

`SpecForm` is the client wrapper: it owns the input string in state, renders the three example chips, the SpecInput, and the submit button. Submit is disabled when the input is empty (after trim). For Plan A the `onSubmit` callback is just logged; Plan B will wire it to `/api/parse-spec`.

- [ ] **Step 9.1: Write the failing test**

Create `src/components/__tests__/SpecForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpecForm from '@/components/SpecForm';

describe('SpecForm', () => {
  it('renders three example chips', () => {
    render(<SpecForm onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Legal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Healthcare' })).toBeInTheDocument();
  });

  it('fills the textarea when an example chip is clicked', async () => {
    const user = userEvent.setup();
    render(<SpecForm onSubmit={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Legal' }));
    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toMatch(/contract pdf/i);
  });

  it('disables submit when the textarea is empty', () => {
    render(<SpecForm onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: /generate eval suite/i })).toBeDisabled();
  });

  it('disables submit when the textarea is only whitespace', async () => {
    const user = userEvent.setup();
    render(<SpecForm onSubmit={() => {}} />);
    await user.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: /generate eval suite/i })).toBeDisabled();
  });

  it('enables submit when the textarea has content', async () => {
    const user = userEvent.setup();
    render(<SpecForm onSubmit={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'a real spec');
    expect(screen.getByRole('button', { name: /generate eval suite/i })).toBeEnabled();
  });

  it('calls onSubmit with the trimmed spec when submit is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SpecForm onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox'), '  hello spec  ');
    await user.click(screen.getByRole('button', { name: /generate eval suite/i }));
    expect(onSubmit).toHaveBeenCalledWith('hello spec');
  });
});
```

- [ ] **Step 9.2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/__tests__/SpecForm.test.tsx`

Expected: FAIL with "Cannot find module '@/components/SpecForm'".

- [ ] **Step 9.3: Implement `SpecForm.tsx`**

Create `src/components/SpecForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import SpecInput from '@/components/SpecInput';
import { EXAMPLES } from '@/lib/examples';

type Props = {
  onSubmit: (spec: string) => void;
};

export default function SpecForm({ onSubmit }: Props) {
  const [spec, setSpec] = useState('');

  const trimmed = spec.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => setSpec(ex.spec)}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted hover:border-border-hover hover:text-fg transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <SpecInput value={spec} onChange={setSpec} />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-accent px-4 py-2 font-display text-sm text-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Generate Eval Suite
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 9.4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/__tests__/SpecForm.test.tsx`

Expected: 6 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add src/components/SpecForm.tsx src/components/__tests__/SpecForm.test.tsx
git commit -m "feat: add SpecForm with example chips and submit"
```

---

## Task 10: Page hero + form composition

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 10.1: Replace `page.tsx`**

Replace the **entire** contents of `src/app/page.tsx` with:

```tsx
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
```

- [ ] **Step 10.2: Smoke-test in dev server**

Run: `npm run dev`. Open `http://localhost:3000`. Verify in order:

1. Hero renders: "EvalForge" in Space Mono, sub-line in IBM Plex Sans.
2. Three chips visible: Legal, Sales, Healthcare.
3. Textarea is empty, submit button is disabled (grayed out).
4. Click "Legal" — textarea fills with the legal spec, submit button enables.
5. Open DevTools console; click submit. See `submit <legal spec>` logged.
6. Clear textarea, submit disables again.
7. Footer visible at the bottom.

Stop dev server.

- [ ] **Step 10.3: Run the full test suite**

Run: `npm run test:run`

Expected: all tests pass. Total count = 1 (sanity) + 3 (Nav) + 2 (Footer) + 4 (SpecInput) + 6 (SpecForm) = **16 tests**.

- [ ] **Step 10.4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: render hero + spec form on home page"
```

---

## Task 11: Production build + env var template

**Files:**
- Create: `.env.local.example`

- [ ] **Step 11.1: Create `.env.local.example`**

Create `.env.local.example`:

```
# Get your key from https://aistudio.google.com/apikey
GEMINI_API_KEY=
```

- [ ] **Step 11.2: Verify `.env.local` is gitignored**

Run: `git check-ignore .env.local`

Expected: prints `.env.local` (meaning it's ignored). If not, add `.env.local` to `.gitignore` before committing anything secret.

The default `.gitignore` from `create-next-app` already includes `.env*` patterns — verify by reading `.gitignore`.

- [ ] **Step 11.3: Run a production build**

Run: `npm run build`

Expected: build completes. No type errors. No errors about missing fonts or CSS.

- [ ] **Step 11.4: Run lint**

Run: `npm run lint`

Expected: no errors. (Warnings about console.log in `page.tsx` are acceptable — that line is replaced in Plan B.)

- [ ] **Step 11.5: Run all tests once more**

Run: `npm run test:run`

Expected: all 16 tests pass.

- [ ] **Step 11.6: Commit**

```bash
git add .env.local.example
git commit -m "chore: add env var template for GEMINI_API_KEY"
```

---

## Plan A — Done-When checklist

The plan is complete when **all** of the following are true:

- [ ] `npm run test:run` exits 0 with all 16 tests passing.
- [ ] `npm run build` completes without errors.
- [ ] `npm run lint` reports no errors.
- [ ] Visiting `http://localhost:3000` shows: dark canvas, sticky Nav with "EvalForge" + "Built by Siddharth", hero "EvalForge" in Space Mono, three example chips, empty textarea, disabled submit, Footer.
- [ ] Clicking each of the three chips fills the textarea with the corresponding spec.
- [ ] Submit toggles disabled/enabled correctly with empty / whitespace / content states.
- [ ] No `console.error` from React in the browser console on initial render.
- [ ] All commits use Conventional Commits (`feat:`, `chore:`).

When this is green, hand off to **Plan B (Generation pipeline)**.

---

## Out of scope for Plan A (handled in B/C)

- `lib/gemini.ts`, `lib/prompts.ts`, `lib/types.ts`
- Any `src/app/api/**` routes
- `DomainBadge`, `TestSuiteTable`, `RubricPanel`, `EvalRunner`, `Scorecard`
- Real `onSubmit` wiring (currently `console.log`)
- 5000-char input cap (Plan C — polish)
- Mobile responsive tuning (Plan C — polish)
- OG image / additional metadata (Plan C — polish)
