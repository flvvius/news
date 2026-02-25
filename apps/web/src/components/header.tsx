import { Link } from "@tanstack/react-router";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/feed", label: "Feed" },
    { to: "/dashboard", label: "Dashboard" },
  ] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-6 py-4">
        <Link to="/" className="text-xl font-bold">
          Biviant
        </Link>
        <nav className="flex gap-6">
          {links.map(({ to, label }) => {
            return (
              <Link
                key={to}
                to={to}
                className="text-sm font-medium hover:text-primary transition-colors"
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <hr />
    </div>
  );
}
