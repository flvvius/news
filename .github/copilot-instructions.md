# Biviant — Coding Conventions

## Convex Mutations: Always Wrap with TanStack Query

**Rule:** Never use `useMutation` from `convex/react` directly in web app components. Always wrap Convex mutations with TanStack Query's `useMutation` + `useConvexMutation`.

**Why:** Convex's `useMutation` returns a bare async function with no built-in state tracking. TanStack Query's `useMutation` provides `isPending`, `isSuccess`, `isError`, `error`, `reset()`, and retry logic — eliminating manual state management for loading/error/success flows. Note that `useMutation` does **not** deduplicate concurrent calls by default; if you need to prevent parallel duplicate writes, implement guards at the UI level (e.g., `disabled={isPending}` on submit buttons) or use server-side idempotency.

**Pattern:**

```tsx
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@news-app/backend/convex/_generated/api";

// Basic usage
const doSomething = useMutation({
  mutationFn: useConvexMutation(api.module.functionName),
});

// With callbacks
const doSomething = useMutation({
  mutationFn: useConvexMutation(api.module.functionName),
  onSuccess: (data) => {
    // handle success
  },
  onError: (error) => {
    console.error(error);
    // show user-safe message
  },
});

// Triggering
doSomething.mutate({ arg1: "value" });

// State (no manual useState needed)
doSomething.isPending; // loading
doSomething.isError; // failed
doSomething.isSuccess; // succeeded
doSomething.error; // Error object
doSomething.data; // return value
doSomething.reset(); // clear state
```

**Do NOT do this:**

```tsx
// ❌ Wrong — raw Convex mutation with manual state
import { useMutation } from "convex/react";
const [status, setStatus] = useState("idle");
const doSomething = useMutation(api.module.functionName);
// ... manual try/catch/finally with setStatus everywhere
```

## Convex Queries: Use `convex/react` useQuery or TanStack convexQuery

Both are valid. The project uses `useQuery` from `convex/react` for most reactive subscriptions and `convexQuery` from `@convex-dev/react-query` for SSR/route loaders.

## Error Messages

- Never expose raw `error.message` to users — log it and show a generic message.
- Use `console.error` for diagnostics, user-safe strings for UI.

## Accessibility

- Forms must have `aria-label` on inputs and ARIA live regions (`aria-live`, `role`) on status messages.
- Buttons must have visible text or `aria-label`.
- Pressables (React Native) must have `accessibilityRole="button"` and `accessibilityLabel`.
