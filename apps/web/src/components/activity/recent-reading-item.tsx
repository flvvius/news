import { Link } from "@tanstack/react-router";
import { Newspaper } from "lucide-react";
import { formatRelativeTimestamp } from "@/lib/dates";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";

// BIV-821: time spent and scroll depth are still collected on the interaction
// metadata but are intentionally not displayed here.
export type RecentReadingEntry = {
  event: {
    slug: string;
    title: string;
    imageUrl?: string | null;
    sourceCount?: number;
  };
  lastViewedAt: number;
  metadata?: {
    timeSpentSeconds?: number;
    scrollDepthPercentage?: number;
    deviceType?: string;
  };
};

export function RecentReadingItem({ entry }: { entry: RecentReadingEntry }) {
  const locale = useLocale();
  const t = useT();
  const sourceCount = entry.event.sourceCount ?? 0;

  return (
    <Link
      to="/event/$slug"
      params={{ slug: entry.event.slug }}
      className="group flex gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
      data-slot="recent-reading-item"
    >
      <div
        className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted"
        data-slot="recent-reading-thumbnail"
      >
        {entry.event.imageUrl ? (
          <img
            src={entry.event.imageUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            <Newspaper className="size-5" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1" data-slot="recent-reading-copy">
        <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
          {entry.event.title}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatRelativeTimestamp(entry.lastViewedAt, locale)}</span>
          <span>·</span>
          <span>
            {sourceCount === 1
              ? t("activity.sourcesOne")
              : t("activity.sourcesMany").replace(
                  "{count}",
                  String(sourceCount),
                )}
          </span>
        </div>
      </div>
    </Link>
  );
}
