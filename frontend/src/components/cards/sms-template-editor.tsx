import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SMS_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{cardUrl}", label: "Card download link" },
  { token: "{link}", label: "Same as {cardUrl}" },
  { token: "{name}", label: "Guest's full name" },
  { token: "{phone}", label: "Guest's phone number" },
  { token: "{number}", label: "Same as {phone}" },
];

interface SMSTemplateEditorProps {
  messageTemplate: string;
  onTemplateChange: (template: string) => void;
  templatePreview: string;
  isSaving: boolean;
  onSave: () => void;
}

export function SMSTemplateEditor({
  messageTemplate,
  onTemplateChange,
  templatePreview,
  isSaving,
  onSave,
}: SMSTemplateEditorProps) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <p className="text-sm font-medium">SMS message body</p>
          <p className="text-xs text-muted-foreground">
            Click a placeholder below to insert it into your message
          </p>
        </div>
        <textarea
          value={messageTemplate}
          onChange={(event) => onTemplateChange(event.target.value)}
          rows={4}
          maxLength={800}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="e.g. Hi {name}, your invitation card is ready: {cardUrl}"
        />
        <div className="flex flex-wrap gap-1">
          {SMS_PLACEHOLDERS.map(({ token, label }) => (
            <button
              key={token}
              type="button"
              title={label}
              onClick={() => onTemplateChange(messageTemplate + token)}
              className="rounded-md border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            >
              {token}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <p className="rounded-md bg-muted px-3 py-2 text-xs break-all text-muted-foreground">
            {templatePreview}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {messageTemplate.length}/800 characters
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={onSave}
          >
            {isSaving ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { SMS_PLACEHOLDERS };
