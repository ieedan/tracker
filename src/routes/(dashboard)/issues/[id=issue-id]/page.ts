import { Div } from "@implementjs/core";
import type { PageProps } from "./$types";

export default function Page({ data }: PageProps) {
    return Div({}, data.bind('issue').bind('title'))
}
