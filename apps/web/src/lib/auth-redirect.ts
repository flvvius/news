export type AuthRedirectPath =
  | "/"
  | "/activitate"
  | "/salvate"
  | "/bookmarks"
  | "/dashboard"
  | "/feed"
  | "/quiz"
  | "/unsubscribe"
  | "/api/auth/$"
  | `/source/${string}`
  | `/event/${string}`;

export function isAuthRedirectPath(value: string): value is AuthRedirectPath {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return false;
  }

  return (
    value === "/" ||
    value === "/activitate" ||
    value === "/salvate" ||
    value === "/bookmarks" ||
    value === "/dashboard" ||
    value === "/feed" ||
    value === "/quiz" ||
    value === "/unsubscribe" ||
    value === "/api/auth/$" ||
    value.startsWith("/source/") ||
    value.startsWith("/event/")
  );
}
