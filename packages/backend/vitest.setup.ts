// Several Convex modules resolve required auth/email config at import time
// (e.g. `auth.ts` calls requireEnv("SITE_URL")). convex-test loads the whole
// function tree, so these must be present before any module is imported, or
// test collection throws. Values are throwaway — no test exercises real auth.
process.env.SITE_URL ??= "http://localhost:3001";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
