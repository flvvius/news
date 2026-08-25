import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/LocaleContext";

/**
 * Full-page loading state.
 *
 * Skeletons mirror the geometry of the content they stand in for (feed-style
 * rows on a plain background), so the page does not shift when the data lands
 * — and so the loading screen does not promise card chrome the loaded page no
 * longer has. `cardCount` keeps its name for call-site compatibility; it is
 * the number of placeholder rows.
 */
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
  const resolvedTitle = title ?? t("common.loading.title");
  const resolvedDescription = description ?? t("common.loading.body");
  return (
    <div aria-busy="true" className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div
          className="border-b border-border pb-6"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="text-sm font-medium text-foreground">
            {resolvedTitle}
          </p>
          <p className="mt-1 max-w-[52ch] text-sm text-muted-foreground">
            {resolvedDescription}
          </p>
        </div>

        <div className="divide-y divide-border">
          {Array.from({ length: cardCount }).map((_, index) => (
            <div key={index} className="space-y-3 py-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-1 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
