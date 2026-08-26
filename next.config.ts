import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // @huggingface/transformers loads onnxruntime-node, which pulls in a native
    // .node addon + libonnxruntime.so — never bundle it, require it at runtime.
    serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

    outputFileTracingIncludes: {
        // Only /search embeds text. Two things the tracer can't see on its own:
        //   1. models/  — read from disk by app/lib/clip.ts via a computed path.
        //   2. onnxruntime-node's native binary — loaded by a fully-dynamic
        //      require(`../bin/napi-v6/${platform}/${arch}/...`). Vercel is
        //      linux/x64; ship that prebuild (~35 MB) and nothing else.
        "/search": [
            "./models/**/*",
            "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
        ],
    },

    outputFileTracingExcludes: {
        // A stray HF Hub download cache can appear here in local dev (a 254 MB
        // fp32 model). It never exists on a clean Vercel install — and
        // app/lib/clip.ts forbids remote downloads — but keep it out regardless.
        "*": ["./node_modules/@huggingface/transformers/.cache/**"],
    },
};

export default nextConfig;
