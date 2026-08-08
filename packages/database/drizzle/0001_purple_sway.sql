CREATE TYPE "public"."criterion_origin" AS ENUM('human', 'ai_suggested');--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD COLUMN "origin" "criterion_origin" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD COLUMN "suggested_by_ai_run_id" uuid;--> statement-breakpoint
CREATE INDEX "rubric_criteria_brouillons_idx" ON "rubric_criteria" USING btree ("rubric_version_id") WHERE "rubric_criteria"."validation_status" = 'draft' AND "rubric_criteria"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_origine_tracee" CHECK ("rubric_criteria"."origin" <> 'ai_suggested' OR "rubric_criteria"."suggested_by_ai_run_id" IS NOT NULL);