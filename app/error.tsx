"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
    return (
        <main className="pt-16 p-4 container mx-auto text-white">
            <h1 className="text-2xl">Error</h1>
            <p>An unexpected error occurred.</p>
            <button
                onClick={reset}
                className="mt-4 h-10 px-4 rounded-full bg-[#252525]"
            >
                Try again
            </button>
        </main>
    );
}
