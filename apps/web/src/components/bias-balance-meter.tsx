import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/LocaleContext";

type BiasBalanceMeterProps = {
  value: number;
  className?: string;
};

function getBiasBalanceLabel(
  value: number,
  t: ReturnType<typeof useT>,
) {
  const absolute = Math.abs(value);
  if (absolute < 15) {
    return t("bias.label.balanced");
  }
  if (value < 0) {
    return absolute >= 60 ? t("bias.label.leftStrong") : t("bias.label.left");
  }
  return absolute >= 60 ? t("bias.label.rightStrong") : t("bias.label.right");
}

function getBiasBalanceCopy(
  value: number,
  t: ReturnType<typeof useT>,
) {
  const absolute = Math.abs(value);
  if (absolute < 15) {
    return t("bias.copy.balanced");
  }
  if (value < 0) {
    return absolute >= 60
      ? t("bias.copy.leftStrong")
      : t("bias.copy.left");
  }
  return absolute >= 60
    ? t("bias.copy.rightStrong")
    : t("bias.copy.right");
}

export default function BiasBalanceMeter({
  value,
  className,
}: BiasBalanceMeterProps) {
  const t = useT();
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
  const label = getBiasBalanceLabel(clampedValue, t);
  const copy = getBiasBalanceCopy(clampedValue, t);

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
            {t("bias.balance")}
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
          <span>{t("bias.leftHeavy")}</span>
          <span>{t("bias.center")}</span>
          <span>{t("bias.rightHeavy")}</span>
        </div>
      </div>
    </div>
  );
}
