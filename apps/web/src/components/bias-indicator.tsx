import { useT } from "@/lib/i18n/LocaleContext";

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
  const sorted = (raw.slice(0, 4) as number[]).sort((a, b) => a - b);
  return sorted;
}

const BiasIndicator = ({
  bias,
  size = "md",
  thresholds: thresholdsProp,
}: BiasIndicatorProps) => {
  const t = useT();
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
    if (biasValue < thresholds[0]) return t("bias.label.leftStrong");
    if (biasValue < thresholds[1]) return t("bias.label.left");
    if (biasValue <= thresholds[2]) return t("bias.center");
    if (biasValue <= thresholds[3]) return t("bias.label.right");
    return t("bias.label.rightStrong");
  };

  // Determine text color
  const getTextColor = (biasValue: number) => {
    if (biasValue < thresholds[0]) return "text-bias-left";
    if (biasValue < thresholds[1]) return "text-bias-left-muted";
    if (biasValue <= thresholds[2]) return "text-bias-center";
    if (biasValue <= thresholds[3]) return "text-bias-right-muted";
    return "text-bias-right";
  };

  const sizeClasses = {
    sm: "h-1.5 w-20",
    md: "h-2 w-28",
    lg: "h-2.5 w-36",
  };

  const dotSizeClasses = {
    sm: "size-3",
    md: "size-4",
    lg: "size-5",
  };

  const textSizeClasses = {
    sm: "text-xs",
    md: "text-xs",
    lg: "text-sm",
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative rounded-full bg-bias-track ${sizeClasses[size]}`}
        role="meter"
        aria-valuenow={bias}
        aria-valuemin={-5}
        aria-valuemax={5}
        aria-label={`${t("bias.balance")}: ${getLabel(bias)}`}
      >
        {/* Gradient track for visual interest */}
        <div className="absolute inset-0 rounded-full overflow-hidden opacity-40">
          <div className="absolute inset-0 bg-linear-to-r from-bias-left via-bias-center to-bias-right" />
        </div>

        {/* Indicator dot */}
        <div
          className={`absolute top-1/2 rounded-full border-2 border-card shadow-sm ${getColor(bias)} ${dotSizeClasses[size]}`}
          style={{
            left: `${Math.max(0, Math.min(100, position))}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>
      <span
        className={`font-medium ${textSizeClasses[size]} ${getTextColor(bias)}`}
      >
        {getLabel(bias)}
      </span>
    </div>
  );
};

export default BiasIndicator;
