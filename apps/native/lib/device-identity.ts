import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

/**
 * Guest identity + first-run persistence, backed by SecureStore.
 *
 * The device id is a plain v4 UUID minted on first launch (no Better Auth
 * anonymous session). It keys the local guest interaction queue and the merge
 * mutation, and rides along on PostHog events as a super property. It rotates
 * on logout so no guest data bleeds between accounts.
 *
 * Keys follow the existing `biviant.*` SecureStore convention and stay
 * separate from the Better Auth storage prefix on purpose — sign-out purges
 * auth entries and must not wipe the device identity or onboarding state.
 */

const DEVICE_ID_KEY = "biviant.device-id";
const ONBOARDING_VERSION_KEY = "biviant.onboarding-version";

/**
 * The onboarding "version" the current build expects to have been completed.
 * Stored as a string rather than a boolean so a future redesign can re-show
 * onboarding to everyone by bumping this — a stored "v1" no longer equals
 * "v2", so {@link hasCompletedOnboarding} returns false until it's redone.
 */
export const CURRENT_ONBOARDING_VERSION = "v1";

async function readItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // An unreadable store is treated as "absent" everywhere below.
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Persistence is best-effort; the in-memory value still applies this run.
  }
}

/**
 * Tri-state read (Ticket 9): distinguish "read succeeded, empty" (genuine first
 * launch → mint) from "read threw" (transient keychain failure → must NOT mint,
 * or a stored id gets overwritten and one guest splits into two identities).
 */
type ReadAttempt = { ok: true; value: string | null } | { ok: false };

async function tryReadItem(key: string): Promise<ReadAttempt> {
  try {
    return { ok: true, value: await SecureStore.getItemAsync(key) };
  } catch {
    return { ok: false };
  }
}

const DEVICE_ID_READ_ATTEMPTS = 3;
const DEVICE_ID_READ_RETRY_MS = 60;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return the stored device id, minting + persisting one only on a genuine first
 * launch. A transient read failure is retried; if it never succeeds we return
 * an ephemeral, UNPERSISTED id so a possibly-existing stored id survives for the
 * next launch (Ticket 9) — we never mint over an unknown store.
 */
export async function loadOrCreateDeviceId(): Promise<string> {
  for (let attempt = 0; attempt < DEVICE_ID_READ_ATTEMPTS; attempt++) {
    const result = await tryReadItem(DEVICE_ID_KEY);
    if (result.ok) {
      if (result.value) return result.value; // existing id
      // Read succeeded and was empty → real first launch: mint + persist.
      const id = Crypto.randomUUID();
      await writeItem(DEVICE_ID_KEY, id);
      return id;
    }
    // Read threw — wait briefly and retry; do NOT mint on a transient failure.
    if (attempt < DEVICE_ID_READ_ATTEMPTS - 1) {
      await delay(DEVICE_ID_READ_RETRY_MS);
    }
  }
  // Every read threw: use an ephemeral id for this session WITHOUT persisting,
  // so we don't clobber a stored id we simply couldn't read.
  return Crypto.randomUUID();
}

/**
 * Mint and persist a fresh device id, discarding the previous one. Called on
 * logout so the next guest session cannot be linked to the account that just
 * signed out.
 */
export async function rotateDeviceId(): Promise<string> {
  const id = Crypto.randomUUID();
  await writeItem(DEVICE_ID_KEY, id);
  return id;
}

/** Whether onboarding for the current version has been completed. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const stored = await readItem(ONBOARDING_VERSION_KEY);
  return stored === CURRENT_ONBOARDING_VERSION;
}

/** Persist that onboarding for the current version is done (Screen A skip/continue). */
export async function markOnboardingComplete(): Promise<void> {
  await writeItem(ONBOARDING_VERSION_KEY, CURRENT_ONBOARDING_VERSION);
}
