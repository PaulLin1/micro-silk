import { NavLink } from "react-router";
import { SITE_NAME } from "~/site";

const navItems = [
    { name: "Feed", to: "/" },
    { name: "Channels", to: "/channels" },
    { name: "Search", to: "/search" },
];

// Solid chips, not underlined text — a row of hard marks, black on white
// (the chrome is b/w only — no accent touches the masthead).
const CHIP =
    "rounded-full px-2.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.15em] bg-ink text-paper transition-opacity sm:px-3 sm:text-xs";

// The one place an accent touches the masthead: each word of the wordmark
// gets one of the accents, cycling. Same idea as oneoneone's "one one one".
const WORDMARK_ACCENTS = ["text-cyan", "text-red", "text-iris", "text-navy"];

export function Masthead() {
    return (
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b-2 border-ink bg-paper px-6 sm:px-10">
            <NavLink
                to="/"
                className="-my-2 min-w-0 shrink truncate py-2 text-sm font-semibold tracking-tight sm:text-base"
            >
                {SITE_NAME.split(" ").map((word, i) => (
                    <span
                        key={i}
                        className={WORDMARK_ACCENTS[i % WORDMARK_ACCENTS.length]}
                    >
                        {i > 0 ? " " : ""}
                        {word}
                    </span>
                ))}
            </NavLink>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
                {navItems.map((item) => (
                    <NavLink
                        key={item.name}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                            `${CHIP} ${isActive ? "opacity-100" : "opacity-55 hover:opacity-100"}`
                        }
                    >
                        {item.name}
                    </NavLink>
                ))}
            </div>
        </header>
    );
}
