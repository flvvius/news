type BiasIndicatorProps = {
  bias: number; // -5 (Left) to +5 (Right)
  size?: "sm" | "md" | "lg";
};

const BiasIndicator = ({ bias, size = "md" }: BiasIndicatorProps) => {
  // Normalize bias to a 0-100 scale for positioning
  const position = ((bias + 5) / 10) * 100;

  // Determine color based on bias
  const getColor = (biasValue: number) => {
    if (biasValue < -2) return "bg-blue-500";
    if (biasValue < -0.5) return "bg-blue-400";
    if (biasValue <= 0.5) return "bg-gray-500";
    if (biasValue <= 2) return "bg-red-400";
    return "bg-red-500";
  };

  // Determine label
  const getLabel = (biasValue: number) => {
    if (biasValue < -2) return "Left";
    if (biasValue < -0.5) return "Lean Left";
    if (biasValue <= 0.5) return "Center";
    if (biasValue <= 2) return "Lean Right";
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
        className={`relative rounded-full bg-gradient-to-r from-blue-500 via-gray-300 to-red-500 ${sizeClasses[size]}`}
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
