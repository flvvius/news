import * as React from "react";

import { cn } from "@/lib/utils";

export const SECTION_TITLE_CLASSNAME =
  "text-base font-semibold leading-6 text-foreground";

type SectionTitleProps = React.ComponentPropsWithoutRef<"h2"> & {
  // "h1" is for pages whose only heading is this one (the feed archive):
  // every document needs exactly one, for assistive tech and for crawlers.
  as?: "h1" | "h2" | "h3" | "p";
};

export function SectionTitle({
  as: Component = "h2",
  className,
  ...props
}: SectionTitleProps) {
  return (
    <Component
      data-slot="section-title"
      className={cn(SECTION_TITLE_CLASSNAME, className)}
      {...props}
    />
  );
}
