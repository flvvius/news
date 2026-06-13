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

/** Return the stored device id, minting and persisting one on first launch. */
export async function loadOrCreateDeviceId(): Promise<string> {
  const existing = await readItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = Crypto.randomUUID();
  await writeItem(DEVICE_ID_KEY, id);
  return id;
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
