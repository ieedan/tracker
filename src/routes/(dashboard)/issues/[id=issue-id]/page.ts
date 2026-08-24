import { Div, Fragment, signal, Span } from "@implementjs/core";
import type { PageProps } from "./$types";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import { PageContent, PageHeader, PageRightSidebar } from "@/lib/components/page/page";
import { BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/lib/components/ui/breadcrumb";
import { PriorityPicker } from "@/lib/features/issues/priority-picker";
import { LabelBadgeList } from "@/lib/features/issues/label-picker";

export default function Page({ data, params }: PageProps) {
    const issue = signal(data.bind('issue').get());
    const labels = signal(issue.bind('labels').get().map((label) => label.id));
    const rightSidebarOpen = signal(true);
    return Fragment({},
        PageHeader(
            BreadcrumbList({},
                BreadcrumbItem(BreadcrumbLink({ to: "/", params: {} }, "Issues")),
                BreadcrumbSeparator({}),
                BreadcrumbItem(BreadcrumbPage(params.id.bind('og'))),
            ),
        ),
        PageContent(
            Div({ class: 'flex flex-col gap-4 items-center' },
                Div({ class: 'flex flex-col gap-2' },
                    Input({ value: issue.bind('title'), variant: 'borderless', class: 'md:text-2xl text-2xl font-semibold w-full' }),
                    Textarea({ value: issue.bind('body'), variant: 'borderless', class: 'w-full' })
                ),
            )
        ),
        PageRightSidebar({ open: rightSidebarOpen, class: 'p-2' },
            Div({ class: 'flex flex-col p-2 gap-2' },
                Span({ class: 'text-muted-foreground text-sm font-medium' }, 'Properties'),
                PriorityPicker({ class: 'border-none rounded-full hover:bg-accent transition-colors', value: issue.bind('priority') }),
                LabelBadgeList({ labels: data.bind('labels'), value: labels })
            ),
        ),
    )
}
