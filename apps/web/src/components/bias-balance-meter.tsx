import { cn } from "@/lib/utils";

type BiasBalanceMeterProps = {
  value: number;
  className?: string;
};

function getBiasBalanceLabel(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 15) {
    return "Balanced";
  }
  if (value < 0) {
    return absolute >= 60 ? "Mostly left" : "Leaning left";
  }
  return absolute >= 60 ? "Mostly right" : "Leaning right";
}

function getBiasBalanceCopy(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 15) {
    return "You’re reading a healthy mix of perspectives.";
  }
  if (value < 0) {
    return absolute >= 60
      ? "Recent reading skews left-leaning."
      : "Recent reading tilts left-leaning.";
  }
  return absolute >= 60
    ? "Recent reading skews right-leaning."
    : "Recent reading tilts right-leaning.";
}

export default function BiasBalanceMeter({
  value,
  className,
}: BiasBalanceMeterProps) {
  const clampedValue = Math.max(-100, Math.min(100, Math.round(value)));
  const indicatorPosition = ((clampedValue + 100) / 200) * 100;
  const indicatorStyle =
    indicatorPosition <= 0
      ? {
          left: "0.5rem",
          transform: "translateY(-50%)",
        }
      : indicatorPosition >= 100
        ? {
            left: "calc(100% - 0.5rem)",
            transform: "translateY(-50%)",
          }
        : {
            left: `${indicatorPosition}%`,
            transform: "translate(-50%, -50%)",
          };
  const label = getBiasBalanceLabel(clampedValue);
  const copy = getBiasBalanceCopy(clampedValue);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-card-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{copy}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-card-foreground">
            {clampedValue > 0 ? "+" : ""}
            {clampedValue}
          </p>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Bias Balance
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative h-3 overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-bias-left-muted/70" />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-bias-right-muted/70" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
          <div
            className="absolute top-1/2 h-4 w-4 rounded-full border-2 border-background bg-card shadow-sm"
            style={indicatorStyle}
            aria-hidden="true"
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Left-heavy</span>
          <span>Balanced</span>
          <span>Right-heavy</span>
        </div>
      </div>
    </div>
  );
}
