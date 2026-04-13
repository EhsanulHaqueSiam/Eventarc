import { useMemo, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Radio, Zap, LogOut, Archive, ChevronDown, ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

function formatShortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AppSidebar() {
  const location = useLocation();
  const user = useQuery(api.auth.getCurrentUser);
  const allEvents = useQuery(api.events.list, {});
  const [showArchived, setShowArchived] = useState(false);

  const { liveEvents, activeEvents, archivedEvents } = useMemo(() => {
    if (!allEvents) return { liveEvents: [], activeEvents: [], archivedEvents: [] };
    return {
      liveEvents: allEvents.filter((e) => e.status === "live"),
      activeEvents: allEvents.filter((e) => e.status === "active"),
      archivedEvents: allEvents.filter((e) => e.status === "completed" || e.status === "archived"),
    };
  }, [allEvents]);

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link to="/events" className="flex items-center gap-2">
          <span className="font-display text-xl font-semibold tracking-tight">
            EventArc
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link to="/events" aria-current={location.pathname === "/events" || location.pathname === "/events/" ? "page" : undefined} />}
                  isActive={location.pathname === "/events" || location.pathname === "/events/"}
                >
                  <CalendarDays className="size-4" />
                  <span>Events</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {liveEvents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Radio className="size-3 text-green-500" />
              Live
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {liveEvents.map((event) => {
                  const eventPath = `/events/${event._id}`;
                  const isActive = location.pathname.startsWith(eventPath);
                  return (
                    <SidebarMenuItem key={event._id}>
                      <SidebarMenuButton
                        render={<Link to="/events/$eventId" params={{ eventId: event._id }} aria-current={isActive ? "page" : undefined} />}
                        isActive={isActive}
                      >
                        <span className="flex-1 truncate">{event.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatShortDate(event.eventDate)}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {activeEvents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Zap className="size-3" />
              Active
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {activeEvents.map((event) => {
                  const eventPath = `/events/${event._id}`;
                  const isActive = location.pathname.startsWith(eventPath);
                  return (
                    <SidebarMenuItem key={event._id}>
                      <SidebarMenuButton
                        render={<Link to="/events/$eventId" params={{ eventId: event._id }} aria-current={isActive ? "page" : undefined} />}
                        isActive={isActive}
                      >
                        <span className="flex-1 truncate">{event.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatShortDate(event.eventDate)}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {archivedEvents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="flex w-full items-center gap-1"
              >
                <Archive className="size-3" />
                Archived ({archivedEvents.length})
                {showArchived ? (
                  <ChevronDown className="ml-auto size-3" />
                ) : (
                  <ChevronRight className="ml-auto size-3" />
                )}
              </button>
            </SidebarGroupLabel>
            {showArchived && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {archivedEvents.map((event) => {
                    const eventPath = `/events/${event._id}`;
                    const isActive = location.pathname.startsWith(eventPath);
                    return (
                      <SidebarMenuItem key={event._id}>
                        <SidebarMenuButton
                          render={<Link to="/events/$eventId" params={{ eventId: event._id }} aria-current={isActive ? "page" : undefined} />}
                          isActive={isActive}
                        >
                          <span className="flex-1 truncate text-muted-foreground">{event.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground/60">
                            {formatShortDate(event.eventDate)}
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {user?.name?.[0]?.toUpperCase() ?? "A"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 truncate">
            <p className="truncate text-sm font-medium">
              {user?.name ?? "Admin"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email ?? ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => void authClient.signOut()}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
