CREATE TABLE "holdout_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"crawled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "arena_block_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "arena_channel_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "item_count" integer;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "block_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "channel_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "arena_user_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "holdout_connections" ADD CONSTRAINT "holdout_connections_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdout_connections" ADD CONSTRAINT "holdout_connections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_holdout_block_channel" ON "holdout_connections" USING btree ("block_id","channel_id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_block_channel" ON "connections" USING btree ("block_id","channel_id");--> statement-breakpoint
CREATE INDEX "connections_channel_idx" ON "connections" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "connections_block_idx" ON "connections" USING btree ("block_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_arena_block_id_unique" UNIQUE("arena_block_id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_arena_channel_id_unique" UNIQUE("arena_channel_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_arena_user_id_unique" UNIQUE("arena_user_id");