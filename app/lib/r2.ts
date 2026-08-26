import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const BUCKET = process.env.R2_BUCKET!;

// keys are `{block_id}.jpg`, matching scripts/download_images.ts's local naming.
// Throws a `Response` (404) when the object is missing so the route handler can
// return it directly.
export async function getImageResponse(key: string): Promise<Response> {
    try {
        const obj = await client.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        );
        if (!obj.Body) throw new Error("empty body");
        const stream = Readable.toWeb(
            obj.Body as Readable,
        ) as ReadableStream<Uint8Array>;
        return new Response(stream, {
            headers: {
                "Content-Type": obj.ContentType ?? "image/jpeg",
                "Cache-Control": "public, max-age=31536000, immutable",
                ...(obj.ContentLength != null
                    ? { "Content-Length": String(obj.ContentLength) }
                    : {}),
            },
        });
    } catch (err: any) {
        if (
            err.name === "NoSuchKey" ||
            err.$metadata?.httpStatusCode === 404
        ) {
            throw new Response("Not found", { status: 404 });
        }
        throw err;
    }
}
