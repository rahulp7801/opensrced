ALTER TABLE "lesson_messages" ADD COLUMN "step" text;--> statement-breakpoint
ALTER TABLE "lesson_steps" ADD COLUMN "done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_steps" ADD COLUMN "hint_level" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_steps" ADD COLUMN "hint_levels" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "gave_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "turns_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "base_sha" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "ide_diff" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "ide_submitted_at" timestamp with time zone;