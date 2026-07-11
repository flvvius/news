// L12 — consent provenance: the signup mutation records the requester's IP.
// Convex mutations cannot see request headers, so a TanStack server function
// reads it from the forwarded headers and the client passes it along.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export const getClientIp = createServerFn({ method: "GET" }).handler(
  (): string | null => {
    const forwarded = getRequestHeader("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() ?? null;
    }
    return getRequestHeader("x-real-ip") ?? null;
  },
);
