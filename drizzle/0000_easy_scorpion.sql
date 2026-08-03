CREATE TABLE "block_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_id" integer NOT NULL,
	"space_version" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"crawled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"arena_block_id" integer NOT NULL,
	"type" text,
	"title" text,
	"source_url" text,
	"image_url" text,
	"crawled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_arena_block_id_unique" UNIQUE("arena_block_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"arena_channel_id" integer NOT NULL,
	"slug" text,
	"title" text,
	"description" text,
	"item_count" integer,
	"user_id" integer,
	"data" jsonb NOT NULL,
	"crawled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channels_arena_channel_id_unique" UNIQUE("arena_channel_id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"crawled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdout_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"crawled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"arena_user_id" integer NOT NULL,
	"username" text,
	"data" jsonb NOT NULL,
	"crawled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_arena_user_id_unique" UNIQUE("arena_user_id")
);
--> statement-breakpoint
ALTER TABLE "block_embeddings" ADD CONSTRAINT "block_embeddings_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdout_connections" ADD CONSTRAINT "holdout_connections_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdout_connections" ADD CONSTRAINT "holdout_connections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_block_embeddings_block_space" ON "block_embeddings" USING btree ("block_id","space_version");--> statement-breakpoint
CREATE INDEX "block_embeddings_hnsw_idx" ON "block_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_block_channel" ON "connections" USING btree ("block_id","channel_id");--> statement-breakpoint
CREATE INDEX "connections_channel_idx" ON "connections" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "connections_block_idx" ON "connections" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_holdout_block_channel" ON "holdout_connections" USING btree ("block_id","channel_id");