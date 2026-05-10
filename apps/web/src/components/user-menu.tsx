import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/LocaleContext";
import { Button } from "./ui/button";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { ChevronDown, Flame, LogOut, User } from "lucide-react";
import { toast } from "sonner";

export default function UserMenu() {
  const t = useT();
  const user = useQuery(api.user.getCurrentUser);
  const streak = user?.stats.currentStreak ?? 0;

  const handleSignOut = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            location.reload();
          },
        },
      });
    } catch (error) {
      console.error("Failed to sign out from user menu:", error);
      toast.error(t("auth.signOutError"));
    }
  };

  const userName = user?.profile?.name || user?.email || t("user.account");
  const userInitial = userName.charAt(0).toUpperCase();
  const streakLabel =
    streak === 1
      ? t("user.streakOne")
      : t("user.streakMany").replace("{count}", String(streak));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 pr-3"
          aria-label={t("user.menu")}
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
          <Flame className="size-4" />
          {streakLabel}
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2 text-muted-foreground">
          <User className="size-4" />
          {t("user.profileSoon")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <LogOut className="size-4" />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
