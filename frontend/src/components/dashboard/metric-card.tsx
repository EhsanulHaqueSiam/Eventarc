import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAnimatedNumber } from "@/hooks/use-animated-number";

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  progress?: number; // 0-100
  rate?: string; // e.g., "45/min"
  className?: string;
}

function AnimatedValue({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  return <>{animated.toLocaleString()}</>;
}

export function MetricCard({
  label,
  value,
  subtitle,
  progress,
  rate,
  className,
}: MetricCardProps) {
  return (
    <Card className={className}>
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-[28px] font-semibold leading-[1.1] transition-opacity duration-300">
          {typeof value === "number" ? <AnimatedValue value={value} /> : value}
        </p>
        {subtitle && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {subtitle}
          </p>
        )}
        {progress !== undefined && (
          <Progress value={progress} className="mt-2 h-1" />
        )}
        {rate && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">{rate}</p>
        )}
      </CardContent>
    </Card>
  );
}
