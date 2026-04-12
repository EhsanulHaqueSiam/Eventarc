import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CascadingSelectProps {
  label: string;
  placeholder: string;
  options: Array<{ value: string; label: string }> | undefined;
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  visible?: boolean;
}

export function CascadingSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  visible = true,
}: CascadingSelectProps) {
  if (!visible) return null;

  // Loading state: options undefined means data is still fetching
  if (options === undefined) {
    return (
      <div className="animate-in fade-in slide-in-from-top-2 space-y-2 duration-150">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-top-2 space-y-2 duration-150">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <Select
        value={value ?? undefined}
        onValueChange={(val) => {
          if (val !== null && val !== undefined) {
            onChange(String(val));
          }
        }}
        disabled={disabled || options.length === 0}
      >
        <SelectTrigger
          className={cn(
            "h-11 w-full",
            !value && "text-muted-foreground",
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No options available
        </p>
      )}
    </div>
  );
}
