/**
 * Product / brand display name (backend copy).
 *
 * The web and mobile apps read the shared name from `@news-app/i18n`; the
 * Convex backend does not depend on that package, so it keeps its own copy
 * here. Keep this value in sync with `packages/i18n/src/brand.ts`. Change it
 * to rename the product in transactional emails and model prompts.
 */
export const BRAND_NAME = "Biviant";
