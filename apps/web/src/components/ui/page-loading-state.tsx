import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/LocaleContext";

export function PageLoadingState({
  title,
  description,
  cardCount = 2,
}: {
  title?: string;
  description?: string;
  cardCount?: number;
}) {
  const t = useT();
  const resolvedTitle = title ?? t("feed.loading");
  const resolvedDescription = description ?? t("activity.loading.body");
  return (
    <div
      aria-busy="true"
      className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]"
    >
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-6">
          <Card className="overflow-hidden border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="gap-4 bg-gradient-to-br from-background via-card to-muted/40">
              <div className="flex items-center gap-3 text-primary">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                  <Loader2 className="size-5 animate-spin" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-8 w-56 max-w-full" />
                </div>
              </div>
            </CardHeader>
            <CardContent
              className="space-y-3 pt-6"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <p className="text-sm font-medium text-foreground">
                {resolvedTitle}
              </p>
              <p className="max-w-[52ch] text-sm text-muted-foreground">
                {resolvedDescription}
              </p>
              <div className="grid gap-2 pt-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {Array.from({ length: cardCount }).map((_, index) => (
              <Card
                key={index}
                className="border-border/70 bg-card/70 shadow-sm backdrop-blur-sm"
              >
                <CardContent className="space-y-4 p-6">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                  <Skeleton className="h-7 w-4/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <div className="flex gap-3 pt-2">
                    <Skeleton className="h-9 w-28 rounded-full" />
                    <Skeleton className="h-9 w-24 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
