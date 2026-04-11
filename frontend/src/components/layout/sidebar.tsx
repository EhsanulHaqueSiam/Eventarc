import { useLocation } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Server } from "lucide-react";
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

const navItems = [
  { title: "Events", href: "/events", icon: CalendarDays },
  { title: "Sizing Guide", href: "/sizing-guide", icon: Server },
];

export function AppSidebar() {
  const location = useLocation();
  const user = useQuery(api.auth.getCurrentUser);

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
                      asChild
                      isActive={isActive}
                    >
                      <Link
                        to={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className="h-10"
                      >
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
