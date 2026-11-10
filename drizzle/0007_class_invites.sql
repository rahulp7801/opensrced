CREATE TABLE "class_invites" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"max_uses" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "class_members" (
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_members_code_user_id_pk" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_code_class_invites_code_fk" FOREIGN KEY ("code") REFERENCES "public"."class_invites"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_members_user_id_index" ON "class_members" USING btree ("user_id");