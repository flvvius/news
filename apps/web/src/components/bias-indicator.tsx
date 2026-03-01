type BiasIndicatorProps = {
  bias: number; // -5 (Left) to +5 (Right)
  size?: "sm" | "md" | "lg";
  /** Validated thresholds from config — pass from parent to avoid per-instance subscriptions. */
  thresholds?: number[];
};

const DEFAULT_THRESHOLDS = [-2, -0.5, 0.5, 2];

function validateThresholds(raw: unknown): number[] {
  if (
    !Array.isArray(raw) ||
    raw.length < 4 ||
    !raw.slice(0, 4).every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    return DEFAULT_THRESHOLDS;
  }
  // Ensure ascending order for the first 4 values
  const sorted = (raw.slice(0, 4) as number[]).sort((a, b) => a - b);
  return sorted;
}

const BiasIndicator = ({
  bias,
  size = "md",
  thresholds: thresholdsProp,
}: BiasIndicatorProps) => {
  const thresholds = validateThresholds(thresholdsProp ?? DEFAULT_THRESHOLDS);

  // Normalize bias to a 0-100 scale for positioning
  const position = ((bias + 5) / 10) * 100;

  // Determine color based on bias — muted, non-political palette
  const getColor = (biasValue: number) => {
    if (biasValue < thresholds[0]) return "bg-bias-left";
    if (biasValue < thresholds[1]) return "bg-bias-left-muted";
    if (biasValue <= thresholds[2]) return "bg-bias-center";
    if (biasValue <= thresholds[3]) return "bg-bias-right-muted";
    return "bg-bias-right";
  };

  // Determine label
  const getLabel = (biasValue: number) => {
    if (biasValue < thresholds[0]) return "Left";
    if (biasValue < thresholds[1]) return "Lean Left";
    if (biasValue <= thresholds[2]) return "Center";
    if (biasValue <= thresholds[3]) return "Lean Right";
    return "Right";
  };

  const sizeClasses = {
    sm: "h-1.5 w-16",
    md: "h-2 w-24",
    lg: "h-3 w-32",
  };

  const dotSizeClasses = {
    sm: "h-2.5 w-2.5",
    md: "h-3 w-3",
    lg: "h-4 w-4",
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative rounded-full bg-bias-track ${sizeClasses[size]}`}
      >
        <div
          className={`absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-background ${getColor(bias)} ${dotSizeClasses[size]}`}
          style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground">
        {getLabel(bias)}
      </span>
    </div>
  );
};

export default BiasIndicator;
