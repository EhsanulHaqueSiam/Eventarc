import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { looksLikePhone } from "@/lib/phone";

export interface GuestFilterValues {
  searchText: string;
  searchType: "name" | "phone";
  categoryId: string | null; // Id<"guestCategories"> or null for all
  status: string | null; // GuestStatus or null for all
}

interface GuestFiltersProps {
  eventId: Id<"events">;
  filters: GuestFilterValues;
  onFilterChange: (filters: GuestFilterValues) => void;
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "invited", label: "Invited" },
  { value: "smsSent", label: "SMS Sent" },
  { value: "smsDelivered", label: "Delivered" },
  { value: "checkedIn", label: "Checked In" },
] as const;

export function GuestFilters({
  eventId,
  filters,
  onFilterChange,
}: GuestFiltersProps) {
  const categories = useQuery(api.categories.listByEvent, { eventId });
  const [searchInput, setSearchInput] = useState(filters.searchText);

  // Debounce search input at 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const searchType = looksLikePhone(searchInput) ? "phone" : "name";
      onFilterChange({
        ...filters,
        searchText: searchInput.trim(),
        searchType,
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const handleStatusChange = (value: string) => {
    onFilterChange({
      ...filters,
      status: value === "all" ? null : value,
    });
  };

  const handleCategoryChange = (value: string) => {
    onFilterChange({
      ...filters,
      categoryId: value === "all" ? null : value,
    });
  };

  return (
    <div className="space-y-3">
      {/* Search and category filter row */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or phone number..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </div>
        {categories && categories.length > 1 && (
          <Select
            value={filters.categoryId ?? "all"}
            onValueChange={handleCategoryChange}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat._id} value={cat._id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Status tabs */}
      <Tabs
        value={filters.status ?? "all"}
        onValueChange={handleStatusChange}
      >
        <TabsList variant="line">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
