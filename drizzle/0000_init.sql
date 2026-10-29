-- pgvector for issues.embedding (Neon and PGlite both ship it). Hand-added:
-- drizzle-kit does not emit extensions.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repo_id" integer NOT NULL,
	"issue_number" integer NOT NULL,
	"reason" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "alerts_userId_repoId_issueNumber_unique" UNIQUE("user_id","repo_id","issue_number")
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lesson_id" uuid,
	"repo_id" integer NOT NULL,
	"pr_number" integer NOT NULL,
	"path" text,
	"state" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"review_rounds" integer DEFAULT 0 NOT NULL,
	"approved_by_maintainer" boolean DEFAULT false NOT NULL,
	"responded_to_review" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "contributions_repoId_prNumber_unique" UNIQUE("repo_id","pr_number")
);
--> statement-breakpoint
CREATE TABLE "env_recipes" (
	"repo_id" integer NOT NULL,
	"recipe_hash" text NOT NULL,
	"source" text NOT NULL,
	"recipe" jsonb NOT NULL,
	"baseline" jsonb,
	"green_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"status" text NOT NULL,
	"unreachable_reason" text,
	CONSTRAINT "env_recipes_repo_id_recipe_hash_pk" PRIMARY KEY("repo_id","recipe_hash")
);
--> statement-breakpoint
CREATE TABLE "env_snapshots" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"recipe_hash" text NOT NULL,
	"base_sha" text NOT NULL,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"repo_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body_excerpt" text DEFAULT '' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"author_assoc" text,
	"comments" integer DEFAULT 0 NOT NULL,
	"closing_pr" integer,
	"fix_files" integer,
	"fix_add" integer,
	"fix_del" integer,
	"review_rounds" integer,
	"merge_hours" integer,
	"difficulty" real,
	"difficulty_reasons" jsonb,
	"scope_nodes" text[],
	"embedding" vector(1024),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "issues"."title" || ' ' || "issues"."body_excerpt")) STORED,
	CONSTRAINT "issues_repo_id_number_pk" PRIMARY KEY("repo_id","number")
);
--> statement-breakpoint
CREATE TABLE "lesson_messages" (
	"lesson_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_messages_lesson_id_seq_pk" PRIMARY KEY("lesson_id","seq")
);
--> statement-breakpoint
CREATE TABLE "lesson_steps" (
	"lesson_id" uuid NOT NULL,
	"step" text NOT NULL,
	"answer" text,
	"grade" jsonb,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_steps_lesson_id_step_pk" PRIMARY KEY("lesson_id","step")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"repo_id" integer NOT NULL,
	"issue_number" integer NOT NULL,
	"run_id" text,
	"path" text,
	"stage" text NOT NULL,
	"mode" text DEFAULT 'short' NOT NULL,
	"answer_key_status" text,
	"revealed_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ide_sandbox" text
);
--> statement-breakpoint
CREATE TABLE "map_coverage" (
	"user_id" text NOT NULL,
	"repo_id" integer NOT NULL,
	"node_id" text NOT NULL,
	"level" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_coverage_user_id_repo_id_node_id_pk" PRIMARY KEY("user_id","repo_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text,
	"language" text,
	"stars" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"catalog" boolean DEFAULT false NOT NULL,
	"health" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "standing_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"ref" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_events_userId_kind_ref_unique" UNIQUE("user_id","kind","ref")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"standing" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_recipes" ADD CONSTRAINT "env_recipes_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_snapshots" ADD CONSTRAINT "env_snapshots_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_messages" ADD CONSTRAINT "lesson_messages_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_steps" ADD CONSTRAINT "lesson_steps_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_coverage" ADD CONSTRAINT "map_coverage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_coverage" ADD CONSTRAINT "map_coverage_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_events" ADD CONSTRAINT "standing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_user_id_index" ON "contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "env_snapshots_repo_id_recipe_hash_index" ON "env_snapshots" USING btree ("repo_id","recipe_hash");--> statement-breakpoint
CREATE INDEX "issues_state_index" ON "issues" USING btree ("state");--> statement-breakpoint
CREATE INDEX "issues_tsv_index" ON "issues" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "issues_embedding_index" ON "issues" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "lessons_user_id_index" ON "lessons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lessons_repo_id_issue_number_index" ON "lessons" USING btree ("repo_id","issue_number");--> statement-breakpoint
CREATE INDEX "repos_catalog_index" ON "repos" USING btree ("catalog");--> statement-breakpoint
CREATE INDEX "users_login_index" ON "users" USING btree ("login");