CREATE TABLE "cloud_leases" (
	"key" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"owner" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_graphs" (
	"repo" text PRIMARY KEY NOT NULL,
	"revision" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cloud_leases_owner_index" ON "cloud_leases" USING btree ("owner");