import { mediaQuery } from "@implementjs/core";

export function useIsMobile() {
    return mediaQuery("(max-width: 767px)");
}
