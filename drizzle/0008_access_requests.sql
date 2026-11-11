CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"github" text NOT NULL,
	"github_id" bigint,
	"status" text NOT NULL,
	"role" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "access_requests_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_github_lower_index" ON "access_requests" USING btree (lower("github"));