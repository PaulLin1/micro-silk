import { NavLink } from "react-router";

const navItems = [
    { name: "Home", to: "/" },
    { name: "Chats", to: "/chats" },
    { name: "Search", to: "/search" },
];

const topNavItems = [
    { name: "Staff Picks", to: "/" },
    { name: "Recent", to: "/recent" },
];

type Photo = {
    id: string;
    width: number;
    height: number;
};

export function Welcome({ photos }: { photos: Photo[] }) {
    return (
        <main className="flex flex-row h-screen">
            {/* Left Navbar */}
            <aside className="flex flex-col w-72 p-5 gap-5">
                <img className="w-10 h-10" src="logo.png" alt="Silk logo" />

                <div className="flex flex-col items-center gap-2 w-full rounded-xl bg-[#131315] p-2">
                    <button className="w-full rounded-xl h-10 bg-[#212123] border-1 border-[#333334] flex items-center justify-center transition-colors">
                        Join Waitlist
                    </button>
                    <button className="w-full rounded-xl h-10 flex items-center justify-start px-4 hover:bg-gray-700 transition-colors">
                        Log In
                    </button>
                </div>

                <div className="flex-1 space-y-1">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.name}
                            to={item.to}
                            end={item.to === "/"}
                            className={({ isActive }) =>
                                `flex h-10 w-full items-center rounded-xl px-4 transition-colors ${
                                    isActive
                                        ? "bg-[#1b1c1e] border-1 border-[#303031] text-white"
                                        : "text-gray-500 hover:text-white transition-colors duration-400"
                                }`
                            }
                        >
                            {item.name}
                        </NavLink>
                    ))}
                </div>

                <div className="flex items-center gap-5 h-10 p-4">
                    <button className="text-gray-500">Settings</button>
                    <button className="text-gray-500">Dark Mode</button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain pl-5 pr-5">
                {/* Top Navbar */}
                <nav className="sticky h-20 top-0 z-10 flex flex-row justify-between items-center w-full">
                    <div className="flex gap-5">
                        {topNavItems.map((item) => (
                            <NavLink
                                key={item.name}
                                to={item.to}
                                end={item.to === "/"}
                                className={({ isActive }) =>
                                    `flex h-10 items-center justify-center rounded-full px-5 transition-colors duration-[400ms] ${
                                        isActive
                                            ? "bg-[#1b1c1e] border border-[#303031] text-white"
                                            : "text-gray-500 hover:text-white"
                                    }`
                                }
                            >
                                <p>{item.name}</p>
                            </NavLink>
                        ))}
                    </div>
                    <button>
                        <p className="text-white">Feed Settings</p>
                    </button>
                </nav>

                {/* Main Content */}
                <div className="flex-1 columns-[17rem] gap-x-4">
                    {photos.map((photo) => {
                        const w = 400;
                        const h = Math.round((photo.height / photo.width) * w);
                        return (
                            <PostCard
                                key={photo.id}
                                imageUrl={`https://picsum.photos/id/${photo.id}/${w}/${h}`}
                                title="forest"
                            />
                        );
                    })}
                </div>
            </div>
        </main>
    );
}

type PostCardProps = {
    imageUrl: string;
    title: string;
};

export function PostCard({ imageUrl, title }: PostCardProps) {
    return (
        <div className="bg-neutral-800 break-inside-avoid mb-4 w-full h-auto pl-1 pr-1 pt-1 border border-gray-700">
            <img
                src={imageUrl}
                alt={title}
                className="object-contain border border-gray-700"
            />
            <p className="p-2 text-white">{title}</p>
        </div>
    );
}
