import { useRef, useCallback, useState } from "react";
import { useCardEditor, type OverlayConfig } from "@/hooks/use-card-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, Eye, ImageIcon } from "lucide-react";
import { toast } from "sonner";

interface CardEditorProps {
  eventId: string;
  onSave: (config: OverlayConfig) => void;
  templateJSON?: object;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Generate a simple placeholder QR SVG as data URL
function generatePlaceholderQR(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
    <rect width="150" height="150" fill="white" stroke="#d4d4d8" stroke-width="2"/>
    <rect x="10" y="10" width="40" height="40" fill="#18181b"/>
    <rect x="100" y="10" width="40" height="40" fill="#18181b"/>
    <rect x="10" y="100" width="40" height="40" fill="#18181b"/>
    <rect x="15" y="15" width="30" height="30" fill="white"/>
    <rect x="105" y="15" width="30" height="30" fill="white"/>
    <rect x="15" y="105" width="30" height="30" fill="white"/>
    <rect x="20" y="20" width="20" height="20" fill="#18181b"/>
    <rect x="110" y="20" width="20" height="20" fill="#18181b"/>
    <rect x="20" y="110" width="20" height="20" fill="#18181b"/>
    <rect x="60" y="60" width="30" height="30" fill="#18181b"/>
    <text x="75" y="148" text-anchor="middle" font-size="8" fill="#71717a">QR Code</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function CardEditor({ onSave, templateJSON }: CardEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasBackground, setHasBackground] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>("");

  const {
    isLoading,
    loadBackground,
    addQROverlay,
    getOverlayConfig,
    toPreviewDataURL,
    loadTemplateJSON,
  } = useCardEditor(canvasRef);

  // Load template if provided
  const templateLoaded = useRef(false);
  if (templateJSON && !templateLoaded.current) {
    templateLoaded.current = true;
    loadTemplateJSON(templateJSON).then(() => setHasBackground(true));
  }

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type (T-08-06 mitigation)
      if (!file.type.match(/^image\/(png|jpeg)$/)) {
        toast.error(
          "Could not load image. Check that it is a valid PNG or JPEG file under 10MB and try again.",
        );
        return;
      }

      // Validate file size (T-08-07 mitigation)
      if (file.size > MAX_FILE_SIZE) {
        toast.error(
          "Could not load image. Check that it is a valid PNG or JPEG file under 10MB and try again.",
        );
        return;
      }

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      await loadBackground(dataUrl);
      setHasBackground(true);

      // Auto-add QR overlay after background loads
      await addQROverlay(generatePlaceholderQR());

      // Reset input so same file can be re-uploaded
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [loadBackground, addQROverlay],
  );

  const handlePreview = useCallback(() => {
    const url = toPreviewDataURL();
    setPreviewUrl(url);
  }, [toPreviewDataURL]);

  const handleSave = useCallback(() => {
    const config = getOverlayConfig();
    if (!config) {
      toast.error("Position the QR overlay before saving");
      return;
    }
    onSave(config);
  }, [getOverlayConfig, onSave]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
        >
          <Upload className="size-4" />
          Upload Background
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              disabled={!hasBackground || isLoading}
              onClick={handlePreview}
            >
              <Eye className="size-4" />
              Preview Composite
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Card Preview</DialogTitle>
            </DialogHeader>
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Card preview"
                className="w-full rounded-md border"
              />
            )}
          </DialogContent>
        </Dialog>

        <Button
          onClick={handleSave}
          disabled={!hasBackground || isLoading}
        >
          Save Template
        </Button>
      </div>

      {/* Canvas area */}
      <div className="relative min-w-[480px] rounded-lg border bg-muted/30 p-4">
        {!hasBackground && !isLoading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
            <ImageIcon className="size-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Upload a background image to start
            </p>
          </div>
        )}
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
