import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas, FabricImage } from "fabric";

export interface OverlayConfig {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
}

export function useCardEditor(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const qrObjectRef = useRef<FabricImage | null>(null);

  // Initialize canvas on mount
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const c = new Canvas(el, {
      width: 800,
      height: 600,
      selection: true,
      backgroundColor: "#f4f4f5",
    });
    setCanvas(c);

    return () => {
      c.dispose();
      setCanvas(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBackground = useCallback(
    async (imageUrl: string) => {
      if (!canvas) return;
      setIsLoading(true);
      try {
        const img = await FabricImage.fromURL(imageUrl, {
          crossOrigin: "anonymous",
        });

        // Scale image to fit canvas while preserving aspect ratio
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();
        const scale = Math.min(
          canvasW / (img.width ?? canvasW),
          canvasH / (img.height ?? canvasH),
        );
        img.scale(scale);

        canvas.backgroundImage = img;
        canvas.requestRenderAll();
      } finally {
        setIsLoading(false);
      }
    },
    [canvas],
  );

  const addQROverlay = useCallback(
    async (sampleQrUrl: string) => {
      if (!canvas) return;
      setIsLoading(true);
      try {
        const qrImg = await FabricImage.fromURL(sampleQrUrl, {
          crossOrigin: "anonymous",
        });

        // Position centered on canvas
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();
        qrImg.set({
          left: canvasW / 2 - (qrImg.width ?? 100) / 2,
          top: canvasH / 2 - (qrImg.height ?? 100) / 2,
          hasControls: true,
          hasBorders: true,
          lockRotation: false,
          cornerStyle: "circle",
          cornerColor: "hsl(var(--primary))",
          borderColor: "hsl(var(--primary))",
          transparentCorners: false,
        });

        // Remove existing QR overlay if any
        if (qrObjectRef.current) {
          canvas.remove(qrObjectRef.current);
        }

        canvas.add(qrImg);
        canvas.setActiveObject(qrImg);
        qrObjectRef.current = qrImg;
        canvas.requestRenderAll();
      } finally {
        setIsLoading(false);
      }
    },
    [canvas],
  );

  const getOverlayConfig = useCallback((): OverlayConfig | null => {
    if (!qrObjectRef.current) return null;
    const obj = qrObjectRef.current;
    return {
      left: Math.round(obj.left ?? 0),
      top: Math.round(obj.top ?? 0),
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
      angle: obj.angle ?? 0,
    };
  }, []);

  const toPreviewDataURL = useCallback((): string => {
    if (!canvas) return "";
    return canvas.toDataURL({ format: "png" });
  }, [canvas]);

  const toTemplateJSON = useCallback((): object => {
    if (!canvas) return {};
    return canvas.toJSON();
  }, [canvas]);

  const loadTemplateJSON = useCallback(
    async (json: object) => {
      if (!canvas) return;
      setIsLoading(true);
      try {
        await canvas.loadFromJSON(json);
        canvas.requestRenderAll();
        // Find QR overlay object after load
        const objects = canvas.getObjects();
        const qrObj = objects.find((o) => o instanceof FabricImage);
        if (qrObj) {
          qrObjectRef.current = qrObj as FabricImage;
        }
      } finally {
        setIsLoading(false);
      }
    },
    [canvas],
  );

  const dispose = useCallback(() => {
    if (canvas) {
      canvas.dispose();
      setCanvas(null);
    }
  }, [canvas]);

  return {
    canvas,
    isLoading,
    loadBackground,
    addQROverlay,
    getOverlayConfig,
    toPreviewDataURL,
    toTemplateJSON,
    loadTemplateJSON,
    dispose,
  };
}
