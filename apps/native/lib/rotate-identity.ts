/**
 * Device-identity rotation contract (Ticket 10). Rotating the stored UUID alone
 * leaves the old PostHog distinct_id + device_uuid super property in place, so
 * the next guest stitches to the account that just signed out. The full
 * contract is: mint a new UUID, reset the analytics person, then re-register the
 * new device_uuid super property.
 *
 * Pure orchestration over injected deps so the contract is unit-testable.
 */
export async function rotateIdentity(deps: {
  rotateStoredDeviceId: () => Promise<string>;
  resetAnalytics: () => void;
  registerDeviceId: (id: string) => void;
}): Promise<string> {
  const id = await deps.rotateStoredDeviceId();
  // Order matters: reset() clears the distinct_id + super properties, then we
  // re-register the device_uuid so anonymous events resume under the NEW id.
  deps.resetAnalytics();
  deps.registerDeviceId(id);
  return id;
}
