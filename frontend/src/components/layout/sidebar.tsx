import { useLocation } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Radio, Zap, LogOut, Archive } from "lucide-react";
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

const navItems = [
  { title: "Events", href: "/events", icon: CalendarDays },
];

export function AppSidebar() {
  const location = useLocation();
  const user = useQuery(api.auth.getCurrentUser);
  const activeEvents = useQuery(api.events.list, { status: "active" });
  const liveEvents = useQuery(api.events.list, { status: "live" });
  const archivedEvents = useQuery(api.events.list, { status: "archived" });

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link to="/events" className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight">
            EventArc
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location.pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link to={item.href} aria-current={isActive ? "page" : undefined} />}
                      isActive={isActive}
                    >
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {liveEvents && liveEvents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Radio className="size-3 text-green-500" />
              Live Events
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
                        <span>{event.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {activeEvents && activeEvents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Zap className="size-3" />
              Active Events
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
                        <span>{event.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {archivedEvents && archivedEvents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Archive className="size-3" />
              Archived
            </SidebarGroupLabel>
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
                        <span>{event.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
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
