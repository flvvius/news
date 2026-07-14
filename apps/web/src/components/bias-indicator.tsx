import { useT } from "@/lib/i18n/LocaleContext";

type BiasIndicatorProps = {
  bias: number; // -5 (Reformist) to +5 (Suveranist)
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

/**
 * The reformist–suveranist axis (MIEZ-6). A horizontal track with camp
 * gradients toward the ends and a neutral --core zone at the centre, plus the
 * source's dot. Deliberately symmetric: reformist (camp-a) is pinned to the
 * left end and suveranist (camp-b) to the right — an arbitrary, fixed choice
 * (bias runs -5→+5, so left = negative), documented so neither end reads as a
 * default. Flipping the component horizontally yields a mirror image.
 *
 * The per-source axis tooltip that links to the methodology lives once under
 * the source list (SourceCoverageSummary), not on every row.
 */
const BiasIndicator = ({
  bias,
  size = "md",
  thresholds: thresholdsProp,
}: BiasIndicatorProps) => {
  const t = useT();
  const thresholds = validateThresholds(thresholdsProp ?? DEFAULT_THRESHOLDS);

  // Normalize bias to a 0-100 scale for positioning.
  const position = ((bias + 5) / 10) * 100;

  // Dot colour: reformist camp / neutral grey midpoint / suveranist camp.
  const dotColor =
    bias < thresholds[1]
      ? "bg-camp-a"
      : bias <= thresholds[2]
        ? "bg-bias-center"
        : "bg-camp-b";

  const trackSize = {
    sm: "h-1.5 w-20",
    md: "h-2 w-28",
    lg: "h-2.5 w-36",
  }[size];
  const dotSize = { sm: "size-3", md: "size-4", lg: "size-5" }[size];
  const labelSize = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
  }[size];

  const endLabel = `font-medium ${labelSize}`;
  const reformist = t("axis.reformist");
  const suveranist = t("axis.suveranist");

  return (
    <div className="flex items-center gap-2">
      {/* Equal type for both ends; each tinted with its own camp -fg token,
          which are tuned to matching lightness/chroma so neither dominates. */}
      <span className={`${endLabel} text-camp-a-fg`}>{reformist}</span>
      <div
        className={`relative shrink-0 rounded-full bg-core-surface ${trackSize}`}
        role="meter"
        aria-valuenow={bias}
        aria-valuemin={-5}
        aria-valuemax={5}
        aria-label={`${reformist} – ${suveranist}`}
        title={t("axis.tooltip")}
      >
        {/* Camp gradient with the neutral grey midpoint at the centre. */}
        <div className="absolute inset-0 overflow-hidden rounded-full opacity-60">
          <div className="absolute inset-0 bg-linear-to-r from-camp-a via-bias-center to-camp-b" />
        </div>

        {/* Source dot. */}
        <div
          className={`absolute top-1/2 rounded-full border-2 border-card shadow-sm ${dotColor} ${dotSize}`}
          style={{
            left: `${Math.max(0, Math.min(100, position))}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>
      <span className={`${endLabel} text-camp-b-fg`}>{suveranist}</span>
    </div>
  );
};

export default BiasIndicator;
