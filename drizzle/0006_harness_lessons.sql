CREATE TABLE "harness_lesson_context" (
	"lesson_id" uuid PRIMARY KEY NOT NULL,
	"issue_title" text NOT NULL,
	"issue_body" text NOT NULL,
	"readme" text NOT NULL,
	"graph" jsonb,
	"key_diff" text,
	"key_diagnosis" text,
	"key_title" text,
	"key_verified" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harness_lesson_context" ADD CONSTRAINT "harness_lesson_context_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;