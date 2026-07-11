/**
 * L12 — waitlist e-mail consent. The exact consent statement shown at
 * collection is versioned here; each signup stores the version + hash +
 * timestamp + IP + source page, so consent is provable per CJEU C-654/23.
 * The web form must render WAITLIST_CONSENT_TEXT verbatim.
 */

export const WAITLIST_CONSENT_TEXT_VERSION = "2026-07-10.v1";

export const WAITLIST_CONSENT_TEXT =
  "Trimite-mi un e-mail când se deschide accesul la Biviant. Mă pot dezabona " +
  "oricând, cu un singur clic, din orice e-mail primit sau de pe pagina de " +
  "dezabonare — fără autentificare.";

/** Deterministic FNV-1a hash (no async crypto in the default runtime). */
export function hashConsentText(text: string): string {
  let hashA = 2166136261;
  let hashB = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + i;
    hashB = Math.imul(hashB, 16777619);
  }
  return `${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
}
