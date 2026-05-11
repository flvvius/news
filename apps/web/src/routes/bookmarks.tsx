import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/bookmarks")({
  beforeLoad: () => {
    throw redirect({ to: "/salvate", replace: true });
  },
});
