import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MoreVertical, Upload, UserPlus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import type { GuestFilterValues } from "./guest-filters";

interface GuestTableProps {
  eventId: Id<"events">;
  filters: GuestFilterValues;
  onAddGuest: () => void;
}

const statusBadgeVariant: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  invited: "default",
  smsSent: "secondary",
  smsDelivered: "outline",
  checkedIn: "default",
};

const statusBadgeClass: Record<string, string> = {
  invited: "",
  smsSent: "",
  smsDelivered: "",
  checkedIn: "bg-success/10 text-success border-success/30",
};

const statusLabel: Record<string, string> = {
  invited: "Invited",
  smsSent: "SMS Sent",
  smsDelivered: "Delivered",
  checkedIn: "Checked In",
};

export function GuestTable({ eventId, filters, onAddGuest }: GuestTableProps) {
  const removeGuest = useMutation(api.guests.remove);

  const isSearching = filters.searchText.length > 0;

  // Browse mode: paginated query
  const paginatedResult = usePaginatedQuery(
    api.guests.listByEvent,
    isSearching
      ? "skip"
      : {
          eventId,
          ...(filters.status
            ? { status: filters.status as "invited" | "smsSent" | "smsDelivered" | "checkedIn" }
            : {}),
          ...(filters.categoryId
            ? { categoryId: filters.categoryId as Id<"guestCategories"> }
            : {}),
        },
    { initialNumItems: 50 },
  );

  // Search mode: name or phone search
  const nameSearchResults = useQuery(
    api.guests.searchByName,
    isSearching && filters.searchType === "name"
      ? {
          eventId,
          searchText: filters.searchText,
          ...(filters.status
            ? { status: filters.status as "invited" | "smsSent" | "smsDelivered" | "checkedIn" }
            : {}),
          ...(filters.categoryId
            ? { categoryId: filters.categoryId as Id<"guestCategories"> }
            : {}),
        }
      : "skip",
  );

  const phoneSearchResults = useQuery(
    api.guests.searchByPhone,
    isSearching && filters.searchType === "phone"
      ? {
          eventId,
          searchText: filters.searchText,
          ...(filters.status
            ? { status: filters.status as "invited" | "smsSent" | "smsDelivered" | "checkedIn" }
            : {}),
          ...(filters.categoryId
            ? { categoryId: filters.categoryId as Id<"guestCategories"> }
            : {}),
        }
      : "skip",
  );

  // Resolve category names
  const categories = useQuery(api.categories.listByEvent, { eventId });
  const categoryMap = new Map(
    (categories ?? []).map((c) => [c._id, c.name]),
  );

  // Determine which data to show
  const searchResults = isSearching
    ? filters.searchType === "name"
      ? nameSearchResults
      : phoneSearchResults
    : null;

  const isLoading = isSearching
    ? searchResults === undefined
    : paginatedResult.status === "LoadingFirstPage";

  const guests = isSearching
    ? searchResults ?? []
    : paginatedResult.results;

  const canLoadMore =
    !isSearching && paginatedResult.status === "CanLoadMore";

  const handleDelete = async (guestId: Id<"guests">) => {
    try {
      await removeGuest({ guestId });
      toast.success("Guest removed");
    } catch {
      toast.error("Failed to remove guest");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  // Empty state
  if (guests.length === 0 && !isSearching) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <div className="text-center">
          <h3 className="text-lg font-semibold">No guests yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Import a CSV or Excel file to add guests in bulk, or add them one
            at a time.
          </p>
        </div>
        <div className="flex gap-3">
          <Button render={<Link to="/events/$eventId/guests/import" params={{ eventId }} />}>
            <Upload className="mr-2 size-4" />
            Import Guests
          </Button>
          <Button variant="outline" onClick={onAddGuest}>
            <UserPlus className="mr-2 size-4" />
            Add Guest
          </Button>
        </div>
      </div>
    );
  }

  // No search results
  if (guests.length === 0 && isSearching) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No guests match your search. Try a different name, phone number, or
          filter.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {guests.map((guest) => (
            <TableRow key={guest._id}>
              <TableCell className="font-medium">{guest.name}</TableCell>
              <TableCell className="font-mono text-sm">
                {guest.phone}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {categoryMap.get(guest.categoryId) ?? "—"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant={statusBadgeVariant[guest.status] ?? "default"}
                  className={statusBadgeClass[guest.status] ?? ""}
                >
                  {statusLabel[guest.status] ?? guest.status}
                </Badge>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7">
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem
                          onSelect={(e) => e.preventDefault()}
                          className="text-destructive"
                        >
                          Remove
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove &apos;{guest.name}&apos;?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This guest will be permanently removed from this
                            event. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(guest._id)}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Load More */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {guests.length} guests
        </p>
        {canLoadMore && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => paginatedResult.loadMore(50)}
            disabled={paginatedResult.status === "LoadingMore"}
          >
            {paginatedResult.status === "LoadingMore"
              ? "Loading..."
              : "Load More"}
          </Button>
        )}
      </div>
    </div>
  );
}
