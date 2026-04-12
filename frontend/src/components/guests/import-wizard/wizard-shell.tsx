import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useImportStore, type WizardStep } from "./use-import-store";
import { StepUpload } from "./step-upload";
import { StepMapColumns } from "./step-map-columns";
import { StepValidate } from "./step-validate";
import { StepDuplicates } from "./step-duplicates";
import { StepConfirm } from "./step-confirm";
import { Check } from "lucide-react";
import type { Id } from "convex/_generated/dataModel";

const STEP_LABELS = ["Upload", "Map", "Validate", "Dupes", "Confirm"] as const;

interface WizardShellProps {
  eventId: Id<"events">;
}

export function WizardShell({ eventId }: WizardShellProps) {
  const step = useImportStore((s) => s.step);
  const setStep = useImportStore((s) => s.setStep);
  const file = useImportStore((s) => s.file);
  const columnMapping = useImportStore((s) => s.columnMapping);
  const validGuests = useImportStore((s) => s.validGuests);
  const importResult = useImportStore((s) => s.importResult);
  const importProgress = useImportStore((s) => s.importProgress);

  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
        return file !== null;
      case 2: {
        const mappedValues = Object.values(columnMapping);
        return (
          mappedValues.includes("name") && mappedValues.includes("phone")
        );
      }
      case 3:
        return validGuests.length > 0;
      case 4:
        return true;
      case 5:
        return false; // Step 5 uses its own confirm button
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step < 5 && canGoNext()) {
      setStep((step + 1) as WizardStep);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((step - 1) as WizardStep);
    }
  };

  const isImporting = importProgress !== null && importResult === null;

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-center">
        {STEP_LABELS.map((label, i) => {
          const stepNum = (i + 1) as WizardStep;
          const isActive = stepNum === step;
          const isCompleted = stepNum < step;

          return (
            <div key={label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                    isActive &&
                      "bg-primary text-primary-foreground",
                    isCompleted &&
                      "bg-primary/10 text-primary",
                    !isActive &&
                      !isCompleted &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-4" />
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={cn(
                    "hidden text-xs sm:block",
                    isActive
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-px w-8 sm:w-12",
                    stepNum < step ? "bg-primary" : "bg-muted",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[300px]">
        {step === 1 && <StepUpload />}
        {step === 2 && <StepMapColumns />}
        {step === 3 && <StepValidate />}
        {step === 4 && <StepDuplicates eventId={eventId} />}
        {step === 5 && <StepConfirm eventId={eventId} />}
      </div>

      {/* Navigation */}
      {step < 5 && (
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 1 || isImporting}
          >
            Back
          </Button>
          <Button onClick={handleNext} disabled={!canGoNext() || isImporting}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
