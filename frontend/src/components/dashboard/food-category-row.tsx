import { Progress } from "@/components/ui/progress";

interface FoodCategoryRowProps {
  category: string;
  served: number;
  limit?: number; // 0 or undefined = unlimited
  rate?: string;
}

export function FoodCategoryRow({
  category,
  served,
  limit,
  rate,
}: FoodCategoryRowProps) {
  const limitDisplay = limit && limit > 0 ? limit.toLocaleString() : "--";
  const progress =
    limit && limit > 0 ? Math.min((served / limit) * 100, 100) : undefined;

  return (
    <div className="space-y-1 py-2">
      <div className="flex items-center justify-between">
        <span className="text-sm">{category}</span>
        <span className="font-mono text-sm">
          {served.toLocaleString()} / {limitDisplay}
        </span>
      </div>
      {progress !== undefined && <Progress value={progress} className="h-1" />}
      {rate && (
        <p className="font-mono text-xs text-muted-foreground">{rate}</p>
      )}
    </div>
  );
}
