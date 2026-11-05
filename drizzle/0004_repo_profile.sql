ALTER TABLE "repos" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "profiled_at" timestamp with time zone;