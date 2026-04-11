import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="mx-auto w-full max-w-[1200px] p-8 md:p-6 sm:p-4">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
