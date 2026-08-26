"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { name: "Home", to: "/" },
    { name: "Chats", to: "/chats" },
    { name: "Search", to: "/search" },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="sticky top-0 flex flex-col w-72 h-screen p-5 gap-5 shrink-0">
            <img className="w-10 h-10" src="/logo.png" alt="Silk logo" />

            <div className="flex flex-col items-center gap-2 w-full rounded-xl bg-[#131315] p-2">
                <button className="w-full rounded-xl h-10 bg-[#212123] border border-[#333334] flex items-center justify-center transition-colors">
                    Join Waitlist
                </button>
                <button className="w-full rounded-xl h-10 flex items-center justify-start px-4 hover:bg-gray-700 transition-colors">
                    Log In
                </button>
            </div>

            <div className="flex-1 space-y-1">
                {navItems.map((item) => {
                    const isActive =
                        item.to === "/"
                            ? pathname === "/"
                            : pathname === item.to || pathname.startsWith(`${item.to}/`);
                    return (
                        <Link
                            key={item.name}
                            href={item.to}
                            className={`flex h-10 w-full items-center rounded-xl px-4 transition-colors ${
                                isActive
                                    ? "bg-[#1b1c1e] border border-[#303031] text-white"
                                    : "text-gray-500 hover:text-white duration-400"
                            }`}
                        >
                            {item.name}
                        </Link>
                    );
                })}
            </div>

            <div className="flex items-center gap-5 h-10 p-4">
                <button className="text-gray-500">Settings</button>
                <button className="text-gray-500">Dark Mode</button>
            </div>
        </aside>
    );
}
