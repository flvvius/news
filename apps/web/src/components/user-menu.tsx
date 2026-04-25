import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { ChevronDown, LogOut, User } from "lucide-react";

export default function UserMenu() {
  const user = useQuery(api.user.getCurrentUser);

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          location.reload();
        },
      },
    });
  };

  const userName = user?.profile?.name || user?.email || "Account";
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 pr-3"
          aria-label="User menu"
        >
          <div className="flex items-center justify-center size-6 rounded-md bg-primary/10 text-primary text-xs font-semibold">
            {userInitial}
          </div>
          <span className="hidden sm:inline max-w-[120px] truncate">
            {userName}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{userName}</p>
            {user?.email && (
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="gap-2 text-muted-foreground">
          <User className="size-4" />
          Profile (Coming soon)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <LogOut className="size-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
