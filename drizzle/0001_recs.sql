ALTER TABLE "issues" ADD COLUMN "features" jsonb;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "ingested_at" timestamp with time zone;