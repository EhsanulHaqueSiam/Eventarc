import { useMemo, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import type { Id } from "convex/_generated/dataModel";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";

interface ExportEventButtonProps {
  eventId: Id<"events">;
  eventName: string;
}

export function ExportEventButton({ eventId, eventName }: ExportEventButtonProps) {
  const convex = useConvex();
  const categories = useQuery(api.categories.listByEvent, { eventId });
  const vendors = useQuery(api.vendors.listByEvent, { eventId });
  const foodRules = useQuery(api.foodRules.listByEvent, { eventId });
  const sessions = useQuery(api.deviceSessions.listAll, { eventId });
  const smsDeliveries = useQuery(api.smsDeliveries.listByEvent, { eventId });
  const [isExporting, setIsExporting] = useState(false);

  const isReady = Boolean(categories && vendors && foodRules && sessions && smsDeliveries);

  const exportRows = useMemo(() => {
    if (!isReady || !categories || !vendors || !foodRules || !sessions || !smsDeliveries) {
      return null;
    }

    const guestCategoryById = new Map(categories.map((c) => [c._id, c.name]));
    const vendorCategoryById = new Map(
      [...vendors.entry.categories, ...vendors.food.categories].map((c) => [c._id, c.name]),
    );

    return {
      guestCategoryById,
      categories: categories.map((category) => ({
        categoryId: category._id,
        name: category.name,
        isDefault: category.isDefault,
      })),
      entryVendors: vendors.entry.categories.flatMap((category) =>
        category.stalls.map((stall) => ({
          categoryId: category._id,
          categoryName: category.name,
          stallId: stall._id,
          stallName: stall.name,
          isActive: stall.isActive,
        })),
      ),
      foodVendors: vendors.food.categories.flatMap((category) =>
        category.stalls.map((stall) => ({
          categoryId: category._id,
          categoryName: category.name,
          stallId: stall._id,
          stallName: stall.name,
          isActive: stall.isActive,
        })),
      ),
      foodRules: foodRules.map((rule) => ({
        guestCategory: guestCategoryById.get(rule.guestCategoryId) ?? "",
        foodCategory: vendorCategoryById.get(rule.foodCategoryId) ?? "",
        limit: rule.limit,
      })),
      sessions: sessions.map((session) => ({
        token: session.token,
        stallName: session.stallName,
        status: session.status,
        scanCount: session.scanCount,
        createdAt: new Date(session.createdAt).toISOString(),
        lastHeartbeat: new Date(session.lastHeartbeat).toISOString(),
      })),
      smsDeliveries: smsDeliveries.map((d) => ({
        guestName: d.guestName ?? "Unknown",
        phone: d.phone,
        status: d.status,
        lastAttemptAt: d.lastAttemptAt ? new Date(d.lastAttemptAt).toISOString() : "",
        deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : "",
        failureReason: d.failureReason ?? "",
      })),
    };
  }, [categories, foodRules, isReady, sessions, smsDeliveries, vendors]);

  const handleExport = async () => {
    if (!exportRows) {
      toast.error("Export is still loading, please try again in a moment.");
      return;
    }

    setIsExporting(true);
    try {
      const guests: Array<{
        _id: Id<"guests">;
        name: string;
        phone: string;
        categoryId: Id<"guestCategories">;
        status: "invited" | "smsSent" | "smsDelivered" | "checkedIn";
        cardImageUrl?: string;
        createdAt: number;
        updatedAt: number;
      }> = [];

      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const pageResult = await convex.query(api.guests.listByEvent, {
          eventId,
          paginationOpts: { numItems: 500, cursor },
        });
        guests.push(...pageResult.page);
        cursor = pageResult.continueCursor;
        isDone = pageResult.isDone;
      }

      const guestRows = guests.map((guest) => ({
        guestId: guest._id,
        name: guest.name,
        phone: guest.phone,
        category: exportRows.guestCategoryById.get(guest.categoryId) ?? "",
        status: guest.status,
        cardImageUrl: guest.cardImageUrl ?? "",
        createdAt: new Date(guest.createdAt).toISOString(),
        updatedAt: new Date(guest.updatedAt).toISOString(),
      }));

      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();

      const addSheet = (sheetName: string, rows: Array<Record<string, unknown>>) => {
        const safeRows = rows.length > 0 ? rows : [{ note: "No data" }];
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(safeRows),
          sheetName,
        );
      };

      addSheet("Guest Categories", exportRows.categories);
      addSheet("Entry Vendors", exportRows.entryVendors);
      addSheet("Food Vendors", exportRows.foodVendors);
      addSheet("Guests", guestRows);
      addSheet("Food Rules", exportRows.foodRules);
      addSheet("Device Sessions", exportRows.sessions);
      addSheet("SMS Deliveries", exportRows.smsDeliveries);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeEventName = eventName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      XLSX.writeFile(workbook, `${safeEventName || "event"}-full-export-${timestamp}.xlsx`);
      toast.success("Excel export downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export event");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button variant="outline" onClick={() => void handleExport()} disabled={!isReady || isExporting}>
      <Download className="mr-2 size-4" />
      {!isReady ? "Preparing export..." : isExporting ? "Exporting..." : "Export Excel"}
    </Button>
  );
}
