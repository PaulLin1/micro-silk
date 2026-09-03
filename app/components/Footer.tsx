import { SITE_NAME } from "~/site";

/**
 * Persistent bottom bar, same styling language as the Masthead (thin rule,
 * uppercase tracked nav, ink-soft body text) — adapted from oneoneone's
 * Footer.tsx. Pinned to the viewport (position: fixed) so it's always on
 * screen — the feed scrolls forever, so a normal end-of-document footer would
 * never actually be reached. Rendered once in root.tsx.
 */
export function Footer() {
    return (
        <footer className="fixed inset-x-0 bottom-0 z-30 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-rule bg-paper px-6 py-2.5 text-[0.7rem] text-ink-soft sm:px-10">
            <span>
                Images via the{" "}
                <a
                    href="https://www.are.na"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-ink"
                >
                    are.na
                </a>{" "}
                API
            </span>
            <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 uppercase tracking-[0.1em]">
                <span className="normal-case tracking-normal">
                    © {new Date().getFullYear()} {SITE_NAME}
                </span>
            </nav>
        </footer>
    );
}
