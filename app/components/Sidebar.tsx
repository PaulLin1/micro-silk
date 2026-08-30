import { NavLink } from "react-router";

const navItems = [
    { name: "Home", to: "/" },
    { name: "Channels", to: "/channels" },
    { name: "Search", to: "/search" },
];

export function Sidebar() {
    return (
        <aside className="sticky top-0 flex flex-col w-72 h-screen p-5 gap-5 shrink-0">
            <img className="w-10 h-10" src="logo.png" alt="Silk logo" />

            <div className="flex-1 space-y-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.name}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                            `flex h-10 w-full items-center rounded-xl px-4 transition-colors ${
                                isActive
                                    ? "bg-[#1b1c1e] border border-[#303031] text-white"
                                    : "text-gray-500 hover:text-white duration-400"
                            }`
                        }
                    >
                        {item.name}
                    </NavLink>
                ))}
            </div>
        </aside>
    );
}
