import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

const defaultStyle = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
} as React.CSSProperties;

const Toaster = ({
  theme = "system",
  className,
  style,
  ...props
}: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className={cn("toaster group", className)}
      style={{ ...defaultStyle, ...style }}
      {...props}
    />
  );
};

export { Toaster };
