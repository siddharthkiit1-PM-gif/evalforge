import { Redis } from '@upstash/redis';
import type { OrchestratorState } from '@/lib/agent/types';

const TTL_SECONDS = 60 * 60 * 24; // 24h

type Backend = {
  get(key: string): Promise<unknown>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

let cached: Backend | null = null;

// In-memory fallback used when Upstash creds are missing (dev/CI).
// Per-process — fine for local dev, NOT safe for serverless.
class MemoryBackend implements Backend {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(entry.value);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<unknown> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async del(key: string): Promise<unknown> {
    this.store.delete(key);
    return 1;
  }
}

function getBackend(): Backend {
  if (cached) return cached;
  // Vercel Marketplace's Upstash integration provisions KV_REST_API_*; the
  // upstream Upstash docs use UPSTASH_REDIS_REST_*. Accept both.
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token });
    cached = {
      get: (k) => redis.get(k),
      setex: (k, ttl, v) => redis.setex(k, ttl, v),
      del: (k) => redis.del(k),
    };
  } else {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[orchState] KV_REST_API_URL/TOKEN not set — falling back to in-memory store. Pause/resume will only work for requests hitting the same instance.',
      );
    }
    cached = new MemoryBackend();
  }
  return cached;
}

// Test-only: reset the cached backend. Safe to call from tests.
export function __resetBackend(): void {
  cached = null;
}

const KEY_PREFIX = 'orch:';

export async function saveState(id: string, state: OrchestratorState): Promise<void> {
  const backend = getBackend();
  await backend.setex(`${KEY_PREFIX}${id}`, TTL_SECONDS, JSON.stringify(state));
}

export async function loadState(id: string): Promise<OrchestratorState | null> {
  const backend = getBackend();
  const raw = await backend.get(`${KEY_PREFIX}${id}`);
  if (raw == null) return null;
  // Upstash returns parsed JSON; memory backend also returns parsed.
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as OrchestratorState;
    } catch {
      return null;
    }
  }
  return raw as OrchestratorState;
}

export async function deleteState(id: string): Promise<void> {
  const backend = getBackend();
  await backend.del(`${KEY_PREFIX}${id}`);
}
