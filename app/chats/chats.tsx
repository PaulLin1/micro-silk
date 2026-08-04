import { NavLink, useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "~/components/Sidebar";
import { PostGrid, type Block } from "~/components/PostGrid";

export function Chats() {

    return (
        <main className="flex flex-row min-h-screen">
            <Sidebar />

            <div className="flex-1 pl-5 pr-5">
                WIP
            </div>
        </main>
    );
}
