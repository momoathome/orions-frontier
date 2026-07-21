CREATE TABLE "bot_controllers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"strategy" varchar(32) DEFAULT 'economic_v1' NOT NULL,
	"next_decision_at" timestamp DEFAULT now() NOT NULL,
	"last_action" varchar(64),
	"last_reason" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_controllers" ADD CONSTRAINT "bot_controllers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bot_controllers_next_decision_at_idx" ON "bot_controllers" USING btree ("next_decision_at");
