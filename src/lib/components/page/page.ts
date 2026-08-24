import { useIsMobile } from "@/lib/hooks/is-mobile";
import { cn } from "@/lib/utils";
import { Div, type Child, Header, Main, type Signal, If, Fragment, ImplementDocument } from "@implementjs/core";
import { Sheet, SheetContent } from "../ui/sheet";

const pageInsetClass = [
    'relative left-(--left-occupied) w-[calc(100%-var(--left-occupied)-var(--right-occupied))]',
    'transition-all duration-150',
];

export function Page(...children: Child[]) {
    const isMobile = useIsMobile();
    return Main({
        class: cn(
            'bg-accent/75 min-h-dvh pt-2',
            '[--header-height:3rem] [--left-sidebar-width:16rem] [--right-sidebar-width:16rem]',
            '[--left-occupied:0px] [--right-occupied:0px]',
            isMobile.bind((isMobile) => !isMobile ? 'has-[[data-left-sidebar][data-state="open"]]:[--left-occupied:var(--left-sidebar-width)]' : ''),
            isMobile.bind((isMobile) => !isMobile ? 'has-[[data-right-sidebar][data-state="open"]]:[--right-occupied:var(--right-sidebar-width)]' : ''),
        ),
    },
        ...children,
    )
}

export function PageContent(...children: Child[]) {
    return Div({
        class: [
            'h-[calc(100dvh-var(--header-height)-8px)] p-2',
            ...pageInsetClass,
        ]
    },
        Div({ class: 'h-full rounded-lg border bg-background' }, ...children,)
    )
}

export function PageHeader(...children: Child[]) {
    return Div({
        class: [
            'h-(--header-height) px-2',
            ...pageInsetClass,
        ]
    },
        Header({
            class: 'flex items-center px-4 py-2 h-(--header-height) border-border border bg-background rounded-lg',
        },
            ...children,
        )
    )
}

export function PageHeaderActionGroup(...children: Child[]) {
    return Div({ class: 'flex items-center gap-2' },
        ...children,
    )
}

export type PageSidebarProps = {
    open: Signal<boolean>;
    class?: string;
}

export function PageRightSidebar({ open, class: className }: PageSidebarProps, ...children: Child[]) {
    const isMobile = useIsMobile();
    return Fragment(
        ImplementDocument({
            onKeydown: () => {
                // TODO: need a hotkey for right sidebar
            }
        }),
        If(
            isMobile
        ).Then(
            Sheet({ open },
                SheetContent({ side: 'right', class: className },
                    ...children
                ),
            ),
        ).Else(
            Div({
                'data-right-sidebar': '',
                'data-state': open.bind((open) => open ? 'open' : 'closed'),
                class: [
                    'py-2 pr-2 fixed right-0 top-0 h-dvh',
                    // states
                    'data-[state="open"]:w-(--right-sidebar-width) data-[state="closed"]:w-0 data-[state="closed"]:translate-x-full',
                    // transitions
                    'transition-all duration-150',
                ]
            },
                Div({
                    class: cn('rounded-lg border bg-background h-full', className)
                }, ...children),
            )
        )
    )
}

export function PageLeftSidebar({ open, class: className }: PageSidebarProps, ...children: Child[]) {
    const isMobile = useIsMobile();
    return Fragment(
        ImplementDocument({
            onKeydown: (event) => {
                if (event.key === "b" && (event.ctrlKey || event.metaKey)) {
                    open.toggle();
                }
            }
        }),
        If(
            isMobile
        ).Then(
            Sheet({ open },
                SheetContent({ side: 'left', class: className },
                    ...children
                ),
            ),
        )
            .Else(
                Div({
                    'data-left-sidebar': '',
                    'data-state': open.bind((open) => open ? 'open' : 'closed'),
                    class: [
                        'py-2 pl-2 fixed left-0 top-0 h-dvh',
                        // states
                        'data-[state="open"]:w-(--left-sidebar-width) data-[state="closed"]:w-0 data-[state="closed"]:-translate-x-full',
                        // transitions
                        'transition-all duration-150',
                    ]
                },
                    Div({
                        class: cn('rounded-lg border bg-background h-full', className)
                    }, ...children),
                )
            )
    )
}
