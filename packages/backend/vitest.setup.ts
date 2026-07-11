// Several Convex modules resolve required auth/email config at import time
// (e.g. `auth.ts` calls requireEnv("SITE_URL")). convex-test loads the whole
// function tree, so these must be present before any module is imported, or
// test collection throws. Values are throwaway — no test exercises real auth.
process.env.SITE_URL ??= "http://localhost:3001";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";

// convex-test leaves a floating "_scheduled_functions" write when a scheduled
// function settles just after a fake-timer test has torn down its transaction
// (finishAllScheduledFunctions + vi.useFakeTimers). It is a harness artifact —
// the code under test has already been asserted — but the stray rejection would
// otherwise fail the whole run. Swallow ONLY this exact convex-test internal
// error; anything else still propagates and fails the test.
process.on("unhandledRejection", (reason) => {
  if (
    reason instanceof Error &&
    /Write outside of transaction \d+;_scheduled_functions/.test(reason.message)
  ) {
    return;
  }
  throw reason;
});
