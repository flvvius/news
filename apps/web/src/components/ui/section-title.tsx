import * as React from "react";

import { cn } from "@/lib/utils";

export const SECTION_TITLE_CLASSNAME =
  "text-base font-semibold leading-6 text-foreground";

type SectionTitleProps = React.ComponentPropsWithoutRef<"h2"> & {
  as?: "h2" | "h3" | "p";
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
