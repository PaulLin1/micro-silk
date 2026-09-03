import { NavLink } from "react-router";
import { SITE_NAME } from "~/site";

const navItems = [
    { name: "Feed", to: "/" },
    { name: "Channels", to: "/channels" },
    { name: "Search", to: "/search" },
];

// Solid color chips, not underlined text — a row of hard marks. Literal
// bg-black/text-yellow: the header bar is always yellow, so its chips need a
// fixed dark fill too.
const CHIP =
    "px-2.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.15em] bg-black text-yellow transition-opacity sm:px-3 sm:text-xs";

export function Masthead() {
    return (
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b-2 border-ink bg-yellow px-6 sm:px-10">
            <NavLink
                to="/"
                className="-my-2 min-w-0 truncate py-2 text-sm font-semibold tracking-tight text-black sm:text-base"
            >
                {SITE_NAME}
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
