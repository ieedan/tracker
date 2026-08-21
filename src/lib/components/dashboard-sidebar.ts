import { Div, signal, Span, type Child } from "@implementjs/core";
import { CalendarIcon, InboxIcon, SearchIcon, SettingsIcon, UsersIcon } from "@implementjs/lucide";
import { Separator } from "@/lib/components/ui/separator";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
} from "@/lib/components/ui/sidebar";

const items = [
	{ title: "Inbox", icon: InboxIcon, badge: "12" },
	{ title: "Search", icon: SearchIcon, badge: null },
	{ title: "Calendar", icon: CalendarIcon, badge: null },
	{ title: "Team", icon: UsersIcon, badge: "3" },
];

export default function DashboardSidebar(...children: Child[]) {
    const active = signal("Inbox");

    return SidebarProvider(
        { class: "min-h-full! [--sidebar-width:13rem]", keyboardShortcut: false },
        Sidebar(
            { collapsible: "icon", class: "h-full!" },
            SidebarHeader(
                Div(
                    { class: "px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]:hidden" },
                    "Acme Inc.",
                ),
            ),
            SidebarContent(
                SidebarGroup(
                    SidebarGroupLabel("Workspace"),
                    SidebarGroupContent(
                        SidebarMenu(
                            ...items.map((item) =>
                                SidebarMenuItem(
                                    SidebarMenuButton(
                                        {
                                                                                        isActive: active.get() === item.title,
                                            onClick: () => active.set(item.title),
                                        },
                                        item.icon({ "aria-hidden": true }),
                                        Span(item.title),
                                    ),
                                    item.badge ? SidebarMenuBadge(item.badge) : null,
                                ),
                            ),
                        ),
                    ),
                ),
            ),
            SidebarFooter(
                SidebarMenu(
                    SidebarMenuItem(
                        SidebarMenuButton(
                            {},
                            SettingsIcon({ "aria-hidden": true }),
                            Span("Settings"),
                        ),
                    ),
                ),
            ),
            SidebarRail(),
        ),
        SidebarInset(
            ...children
        ),
    );
}
