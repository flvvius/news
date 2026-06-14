import * as SecureStore from "expo-secure-store";

/**
 * Apple only returns the user's name/email on the FIRST consent (Ticket 21). If
 * our sign-in call fails after that, a naive retry gets no name from Apple and
 * the account is created nameless. So we persist the first-consent identity
 * locally BEFORE calling the backend, reuse it on retries, and clear it only
 * once the account actually persists.
 */
const APPLE_PENDING_IDENTITY_KEY = "biviant.apple-pending-identity";

export type ApplePendingIdentity = {
  firstName?: string;
  lastName?: string;
  email?: string;
};

export async function savePendingAppleIdentity(
  identity: ApplePendingIdentity,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      APPLE_PENDING_IDENTITY_KEY,
      JSON.stringify(identity),
    );
  } catch {
    // Best-effort; worst case a failed-then-retried first sign-in is nameless.
  }
}

export async function loadPendingAppleIdentity(): Promise<ApplePendingIdentity | null> {
  try {
    const raw = await SecureStore.getItemAsync(APPLE_PENDING_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApplePendingIdentity;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingAppleIdentity(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(APPLE_PENDING_IDENTITY_KEY);
  } catch {
    // Best-effort.
  }
}

/** Whether an identity carries any usable name/email. */
export function hasAppleIdentity(identity: ApplePendingIdentity | null): boolean {
  return Boolean(identity?.firstName || identity?.lastName || identity?.email);
}
