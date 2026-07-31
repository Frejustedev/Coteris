CREATE TYPE "public"."ai_run_status" AS ENUM('success', 'failed', 'skipped_quota');--> statement-breakpoint
CREATE TYPE "public"."ai_task_type" AS ENUM('subject_extraction', 'answer_key_structuring', 'ocr', 'segmentation', 'analysis', 'second_pass', 'comment_generation');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('DRAFT', 'SUBJECT_REVIEW', 'ANSWER_KEY_REVIEW', 'RUBRIC_REVIEW', 'READY_FOR_SUBMISSIONS', 'SUBMISSIONS_PROCESSING', 'GRADING', 'HUMAN_REVIEW', 'FINALIZED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."attribution_type" AS ENUM('all_or_nothing', 'partial', 'per_element', 'manual', 'bonus', 'penalty');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('green', 'orange', 'red');--> statement-breakpoint
CREATE TYPE "public"."criterion_status" AS ENUM('present', 'partial', 'absent');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('coordinator', 'grader', 'tech_admin');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'true_false', 'short_answer', 'short_essay', 'clinical_case');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('accepted', 'modified', 'rejected', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."scan_quality" AS ENUM('acceptable', 'auto_improvable', 'check_recommended', 'reimport_required');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('uploaded', 'quality_checked', 'segmented', 'transcribed', 'graded', 'reviewed', 'finalized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('draft', 'accepted', 'modified', 'rejected');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'grader' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'grader' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"is_personal" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_file_key" text,
	"source_file_name" text,
	"source_mime_type" text,
	"extracted_text" text,
	"content_hash" text NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"level" text,
	"cohort" text,
	"institution" text,
	"exam_date" timestamp with time zone,
	"duration_minutes" integer,
	"language" text DEFAULT 'fr' NOT NULL,
	"max_points" integer NOT NULL,
	"description" text,
	"estimated_candidates" integer,
	"anonymization_enabled" boolean DEFAULT true NOT NULL,
	"status" "assessment_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"assessment_version_id" uuid,
	"number" text NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"type" "question_type" NOT NULL,
	"max_points" integer NOT NULL,
	"parent_question_id" uuid,
	"sort_order" integer NOT NULL,
	"source_page" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "answer_key_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_key_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"validation_status" "validation_status" DEFAULT 'draft' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_key_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_key_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_file_key" text,
	"raw_text" text,
	"content_hash" text NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"attribution" "attribution_type" NOT NULL,
	"max_points" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"partial_ratio_percent" integer DEFAULT 50 NOT NULL,
	"expected_element_count" integer DEFAULT 0 NOT NULL,
	"points_per_element" integer,
	"cap" integer,
	"contradiction_policy" jsonb DEFAULT '{"kind":"ignore"}'::jsonb NOT NULL,
	"factual_error_penalty" integer,
	"excluded_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptable_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"partial_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"common_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ignore_spelling" boolean DEFAULT true NOT NULL,
	"validation_status" "validation_status" DEFAULT 'draft' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "rubric_criteria_max_points_positive" CHECK ("rubric_criteria"."max_points" >= 0),
	CONSTRAINT "rubric_criteria_partial_ratio_range" CHECK ("rubric_criteria"."partial_ratio_percent" BETWEEN 0 AND 100),
	CONSTRAINT "rubric_criteria_per_element_consistent" CHECK ("rubric_criteria"."attribution" <> 'per_element' OR "rubric_criteria"."expected_element_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"answer_key_version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_versions_lock_complete" CHECK (("rubric_versions"."locked_at" IS NULL AND "rubric_versions"."locked_by" IS NULL)
          OR ("rubric_versions"."locked_at" IS NOT NULL AND "rubric_versions"."locked_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"submission_page_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"cropped_image_key" text,
	"is_continuation" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'auto' NOT NULL,
	"confidence" real,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_regions_coordinates_relative" CHECK ("answer_regions"."x" >= 0 AND "answer_regions"."y" >= 0
          AND "answer_regions"."width" > 0 AND "answer_regions"."height" > 0
          AND "answer_regions"."x" + "answer_regions"."width" <= 1.0001
          AND "answer_regions"."y" + "answer_regions"."height" <= 1.0001)
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"submission_id" uuid,
	"question_id" uuid,
	"grader_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_ref" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"cohort" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "submission_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"image_key" text NOT NULL,
	"enhanced_image_key" text,
	"width_px" integer,
	"height_px" integer,
	"dpi" integer,
	"rotation_degrees" integer DEFAULT 0 NOT NULL,
	"quality" "scan_quality",
	"quality_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_blank" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"anonymous_code" text NOT NULL,
	"status" "submission_status" DEFAULT 'uploaded' NOT NULL,
	"quality" "scan_quality",
	"quality_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"original_file_key" text,
	"original_file_name" text,
	"file_hash" text,
	"idempotency_key" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ocr_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_region_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"engine_version" text,
	"full_text" text DEFAULT '' NOT NULL,
	"confidence" real,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_spans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ocr_run_id" uuid NOT NULL,
	"level" text NOT NULL,
	"text" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"x" real,
	"y" real,
	"width" real,
	"height" real,
	"confidence" real,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_region_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"text" text NOT NULL,
	"previous_text" text,
	"source" text NOT NULL,
	"ocr_run_id" uuid,
	"edited_by" uuid,
	"edit_reason" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid,
	"proposed_text" text,
	"text" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid,
	"version_number" integer DEFAULT 1 NOT NULL,
	"points_exact" integer NOT NULL,
	"points_rounded" integer NOT NULL,
	"points_max" integer NOT NULL,
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_published_requires_finalized" CHECK ("grades"."published_at" IS NULL
          OR ("grades"."finalized_at" IS NOT NULL AND "grades"."finalized_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "grading_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"grading_run_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"rubric_criterion_id" uuid NOT NULL,
	"status" "criterion_status" NOT NULL,
	"contradicted" boolean DEFAULT false NOT NULL,
	"factually_wrong" boolean DEFAULT false NOT NULL,
	"matched_element_count" integer DEFAULT 0 NOT NULL,
	"points_possible" integer NOT NULL,
	"points_proposed" integer NOT NULL,
	"points_awarded" integer,
	"confidence" real,
	"confidence_level" "confidence_level",
	"structured_justification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"denied_for_missing_evidence" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_decisions_review_complete" CHECK (("grading_decisions"."points_awarded" IS NULL)
          OR ("grading_decisions"."reviewed_by" IS NOT NULL AND "grading_decisions"."reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "grading_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"grading_decision_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"ocr_span_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"answer_region_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"answer_key_version_id" uuid NOT NULL,
	"transcription_version_id" uuid,
	"prompt_version" integer NOT NULL,
	"pass" text DEFAULT 'first_pass' NOT NULL,
	"unexpected_elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertain_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_human_review" boolean DEFAULT true NOT NULL,
	"confidence" real,
	"confidence_level" "confidence_level",
	"total_proposed" integer,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"grading_decision_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_decision" NOT NULL,
	"points_before" integer NOT NULL,
	"points_after" integer NOT NULL,
	"reason" text,
	"comment" text,
	"rubric_version_id" uuid NOT NULL,
	"answer_key_version_id" uuid NOT NULL,
	"via_bulk_validation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"actor_id" uuid,
	"actor_role" "member_role",
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"ip_address" text,
	"previous_hash" text,
	"hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"task_type" "ai_task_type" NOT NULL,
	"prompt_version" integer NOT NULL,
	"page_count" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_eur" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"status" "ai_run_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid,
	"monthly_budget_micro_eur" bigint NOT NULL,
	"per_assessment_budget_micro_eur" bigint NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"monthly_budget_micro_eur" bigint NOT NULL,
	"max_submissions_per_month" integer NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_budget_bounded" CHECK ("subscription_plans"."monthly_budget_micro_eur" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" text NOT NULL,
	"ai_call_count" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"cost_micro_eur" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_key" text,
	"file_name" text,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_versions" ADD CONSTRAINT "assessment_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_versions" ADD CONSTRAINT "assessment_versions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_versions" ADD CONSTRAINT "assessment_versions_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_assessment_version_id_assessment_versions_id_fk" FOREIGN KEY ("assessment_version_id") REFERENCES "public"."assessment_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_elements" ADD CONSTRAINT "answer_key_elements_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_elements" ADD CONSTRAINT "answer_key_elements_answer_key_version_id_answer_key_versions_id_fk" FOREIGN KEY ("answer_key_version_id") REFERENCES "public"."answer_key_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_elements" ADD CONSTRAINT "answer_key_elements_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_elements" ADD CONSTRAINT "answer_key_elements_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_versions" ADD CONSTRAINT "answer_key_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_versions" ADD CONSTRAINT "answer_key_versions_answer_key_id_answer_keys_id_fk" FOREIGN KEY ("answer_key_id") REFERENCES "public"."answer_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_versions" ADD CONSTRAINT "answer_key_versions_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_keys" ADD CONSTRAINT "answer_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_keys" ADD CONSTRAINT "answer_keys_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_answer_key_version_id_answer_key_versions_id_fk" FOREIGN KEY ("answer_key_version_id") REFERENCES "public"."answer_key_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_regions" ADD CONSTRAINT "answer_regions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_regions" ADD CONSTRAINT "answer_regions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_regions" ADD CONSTRAINT "answer_regions_submission_page_id_submission_pages_id_fk" FOREIGN KEY ("submission_page_id") REFERENCES "public"."submission_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_regions" ADD CONSTRAINT "answer_regions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_grader_id_user_id_fk" FOREIGN KEY ("grader_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_identities" ADD CONSTRAINT "submission_identities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_identities" ADD CONSTRAINT "submission_identities_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_identities" ADD CONSTRAINT "submission_identities_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_pages" ADD CONSTRAINT "submission_pages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_pages" ADD CONSTRAINT "submission_pages_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD CONSTRAINT "ocr_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD CONSTRAINT "ocr_runs_answer_region_id_answer_regions_id_fk" FOREIGN KEY ("answer_region_id") REFERENCES "public"."answer_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_spans" ADD CONSTRAINT "ocr_spans_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_spans" ADD CONSTRAINT "ocr_spans_ocr_run_id_ocr_runs_id_fk" FOREIGN KEY ("ocr_run_id") REFERENCES "public"."ocr_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_versions" ADD CONSTRAINT "transcription_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_versions" ADD CONSTRAINT "transcription_versions_answer_region_id_answer_regions_id_fk" FOREIGN KEY ("answer_region_id") REFERENCES "public"."answer_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_versions" ADD CONSTRAINT "transcription_versions_ocr_run_id_ocr_runs_id_fk" FOREIGN KEY ("ocr_run_id") REFERENCES "public"."ocr_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_versions" ADD CONSTRAINT "transcription_versions_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_finalized_by_user_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_grading_run_id_grading_runs_id_fk" FOREIGN KEY ("grading_run_id") REFERENCES "public"."grading_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_rubric_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("rubric_criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_evidence" ADD CONSTRAINT "grading_evidence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_evidence" ADD CONSTRAINT "grading_evidence_grading_decision_id_grading_decisions_id_fk" FOREIGN KEY ("grading_decision_id") REFERENCES "public"."grading_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_evidence" ADD CONSTRAINT "grading_evidence_ocr_span_id_ocr_spans_id_fk" FOREIGN KEY ("ocr_span_id") REFERENCES "public"."ocr_spans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_answer_region_id_answer_regions_id_fk" FOREIGN KEY ("answer_region_id") REFERENCES "public"."answer_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_answer_key_version_id_answer_key_versions_id_fk" FOREIGN KEY ("answer_key_version_id") REFERENCES "public"."answer_key_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_transcription_version_id_transcription_versions_id_fk" FOREIGN KEY ("transcription_version_id") REFERENCES "public"."transcription_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_grading_decision_id_grading_decisions_id_fk" FOREIGN KEY ("grading_decision_id") REFERENCES "public"."grading_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_reviews" ADD CONSTRAINT "human_reviews_answer_key_version_id_answer_key_versions_id_fk" FOREIGN KEY ("answer_key_version_id") REFERENCES "public"."answer_key_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_quotas" ADD CONSTRAINT "organization_quotas_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_quotas" ADD CONSTRAINT "organization_quotas_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_unique" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_org_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_unique" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_versions_unique" ON "assessment_versions" USING btree ("assessment_id","version_number");--> statement-breakpoint
CREATE INDEX "assessment_versions_org_idx" ON "assessment_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "assessments_org_idx" ON "assessments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "assessments_org_status_idx" ON "assessments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assessments_created_idx" ON "assessments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "questions_assessment_idx" ON "questions" USING btree ("assessment_id","sort_order");--> statement-breakpoint
CREATE INDEX "questions_org_idx" ON "questions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_number_unique" ON "questions" USING btree ("assessment_id","number");--> statement-breakpoint
CREATE INDEX "answer_key_elements_version_idx" ON "answer_key_elements" USING btree ("answer_key_version_id","question_id");--> statement-breakpoint
CREATE INDEX "answer_key_elements_org_idx" ON "answer_key_elements" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_key_versions_unique" ON "answer_key_versions" USING btree ("answer_key_id","version_number");--> statement-breakpoint
CREATE INDEX "answer_key_versions_org_idx" ON "answer_key_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_keys_assessment_unique" ON "answer_keys" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "answer_keys_org_idx" ON "answer_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rubric_criteria_version_idx" ON "rubric_criteria" USING btree ("rubric_version_id","question_id");--> statement-breakpoint
CREATE INDEX "rubric_criteria_org_idx" ON "rubric_criteria" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_unique" ON "rubric_versions" USING btree ("rubric_id","version_number");--> statement-breakpoint
CREATE INDEX "rubric_versions_org_idx" ON "rubric_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubrics_assessment_unique" ON "rubrics" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "rubrics_org_idx" ON "rubrics" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "answer_regions_submission_question_idx" ON "answer_regions" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "answer_regions_page_idx" ON "answer_regions" USING btree ("submission_page_id");--> statement-breakpoint
CREATE INDEX "answer_regions_org_idx" ON "answer_regions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "assignments_grader_idx" ON "assignments" USING btree ("grader_id","assessment_id");--> statement-breakpoint
CREATE INDEX "assignments_submission_idx" ON "assignments" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "assignments_org_idx" ON "assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "students_org_idx" ON "students" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_org_ref_unique" ON "students" USING btree ("organization_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_identities_submission_unique" ON "submission_identities" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_identities_org_idx" ON "submission_identities" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_pages_unique" ON "submission_pages" USING btree ("submission_id","page_number");--> statement-breakpoint
CREATE INDEX "submission_pages_org_idx" ON "submission_pages" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_code_unique" ON "submissions" USING btree ("assessment_id","anonymous_code");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_idempotency_unique" ON "submissions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "submissions_assessment_status_idx" ON "submissions" USING btree ("assessment_id","status");--> statement-breakpoint
CREATE INDEX "submissions_org_idx" ON "submissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "submissions_hash_idx" ON "submissions" USING btree ("assessment_id","file_hash");--> statement-breakpoint
CREATE INDEX "ocr_runs_region_idx" ON "ocr_runs" USING btree ("answer_region_id","created_at");--> statement-breakpoint
CREATE INDEX "ocr_runs_org_idx" ON "ocr_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ocr_spans_run_idx" ON "ocr_spans" USING btree ("ocr_run_id","start_offset");--> statement-breakpoint
CREATE INDEX "ocr_spans_org_idx" ON "ocr_spans" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_versions_unique" ON "transcription_versions" USING btree ("answer_region_id","version_number");--> statement-breakpoint
CREATE INDEX "transcription_versions_org_idx" ON "transcription_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comments_submission_idx" ON "comments" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "comments_org_idx" ON "comments" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_unique" ON "grades" USING btree ("submission_id","question_id","version_number");--> statement-breakpoint
CREATE INDEX "grades_submission_idx" ON "grades" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "grades_org_idx" ON "grades" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_decisions_unique" ON "grading_decisions" USING btree ("grading_run_id","rubric_criterion_id");--> statement-breakpoint
CREATE INDEX "grading_decisions_submission_idx" ON "grading_decisions" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "grading_decisions_criterion_idx" ON "grading_decisions" USING btree ("rubric_criterion_id");--> statement-breakpoint
CREATE INDEX "grading_decisions_org_idx" ON "grading_decisions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "grading_evidence_decision_idx" ON "grading_evidence" USING btree ("grading_decision_id","sort_order");--> statement-breakpoint
CREATE INDEX "grading_evidence_org_idx" ON "grading_evidence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "grading_runs_submission_idx" ON "grading_runs" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "grading_runs_region_idx" ON "grading_runs" USING btree ("answer_region_id","created_at");--> statement-breakpoint
CREATE INDEX "grading_runs_org_idx" ON "grading_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "grading_runs_review_idx" ON "grading_runs" USING btree ("organization_id","needs_human_review");--> statement-breakpoint
CREATE INDEX "human_reviews_decision_idx" ON "human_reviews" USING btree ("grading_decision_id","created_at");--> statement-breakpoint
CREATE INDEX "human_reviews_reviewer_idx" ON "human_reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "human_reviews_org_idx" ON "human_reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_sequence_unique" ON "audit_events" USING btree ("organization_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_events_org_time_idx" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_object_idx" ON "audit_events" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("organization_id","action");--> statement-breakpoint
CREATE INDEX "ai_runs_org_time_idx" ON "ai_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_assessment_idx" ON "ai_runs" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "ai_runs_task_idx" ON "ai_runs" USING btree ("organization_id","task_type");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_quotas_unique" ON "organization_quotas" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_code_unique" ON "subscription_plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_unique" ON "usage_records" USING btree ("organization_id","period");--> statement-breakpoint
CREATE INDEX "exports_assessment_idx" ON "exports" USING btree ("assessment_id","created_at");--> statement-breakpoint
CREATE INDEX "exports_org_idx" ON "exports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");