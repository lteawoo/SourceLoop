import { z } from "zod";

export const runStatusSchema = z.enum(["planned", "running", "completed", "incomplete", "failed"]);
export const questionKindSchema = z.enum(["core", "structure", "deep_dive", "comparison", "execution", "evidence_gap"]);
export const planningModeSchema = z.enum(["ai_default", "questions_file_override"]);

export const plannedQuestionDraftSchema = z.object({
  kind: questionKindSchema.optional(),
  prompt: z.string().min(1),
  objective: z.string().min(1)
});

export const plannedQuestionDraftListSchema = z.array(plannedQuestionDraftSchema).min(1);

export const plannedQuestionSchema = z.object({
  id: z.string().min(1),
  kind: questionKindSchema.optional(),
  prompt: z.string().min(1),
  objective: z.string().min(1),
  order: z.number().int().nonnegative()
});

export const planningScopeSchema = z.object({
  maxQuestions: z.number().int().positive().optional(),
  selectedFamilies: z.array(questionKindSchema).min(1).optional()
});

export const plannedQuestionDraftBundleSchema = z.object({
  questions: plannedQuestionDraftListSchema
});

export const executionScopeSchema = z.object({
  questionIds: z.array(z.string().min(1)).min(1).optional(),
  fromQuestionId: z.string().min(1).optional(),
  limit: z.number().int().positive().optional()
});

export const questionBatchSchema = z.object({
  id: z.string().min(1),
  type: z.literal("question_batch"),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  objective: z.string().min(1),
  intendedOutput: z.string().min(1).optional(),
  planningMode: planningModeSchema.optional(),
  questionFamilies: z.array(questionKindSchema).default([]),
  planningScope: planningScopeSchema.optional(),
  createdAt: z.string().datetime(),
  questions: z.array(plannedQuestionSchema).min(1)
});

export const citationReferenceSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  note: z.string().min(1).optional()
});

export const qaExchangeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("qa_exchange"),
  runId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  questionId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  citations: z.array(citationReferenceSchema),
  createdAt: z.string().datetime(),
  answerSource: z.literal("notebooklm")
});

export const runIndexSchema = z.object({
  id: z.string().min(1),
  type: z.literal("qa_run"),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  questionBatchId: z.string().min(1),
  planningMode: planningModeSchema.optional(),
  status: runStatusSchema,
  executionMode: z.enum(["attached_chrome", "fixture"]).optional(),
  attachedChromeTargetId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  planningScope: planningScopeSchema.optional(),
  executionScope: executionScopeSchema.optional(),
  completedQuestionIds: z.array(z.string().min(1)).default([]),
  failedQuestionId: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  outputArtifacts: z.array(z.string().min(1)).default([])
});

export const questionPlanningContextSchema = z.object({
  id: z.string().min(1),
  type: z.literal("question_planning_context"),
  runId: z.string().min(1),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  notebookUrl: z.string().url().optional(),
  notebookTitle: z.string().min(1).optional(),
  sourceCount: z.number().int().nonnegative().optional(),
  summary: z.string().min(1).optional(),
  objective: z.string().min(1),
  intendedOutput: z.string().min(1).optional(),
  planningMode: planningModeSchema,
  createdAt: z.string().datetime()
});

export const questionPlanningContextPreviewSchema = z.object({
  type: z.literal("question_planning_context_preview"),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  notebookUrl: z.string().url().optional(),
  notebookTitle: z.string().min(1).optional(),
  sourceCount: z.number().int().nonnegative().optional(),
  summary: z.string().min(1).optional(),
  objective: z.string().min(1),
  intendedOutput: z.string().min(1).optional(),
  planningMode: planningModeSchema,
  planningScope: planningScopeSchema.optional(),
  createdAt: z.string().datetime()
});

export const outputArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.literal("output_artifact"),
  runId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  format: z.enum(["brief", "outline"]),
  createdAt: z.string().datetime(),
  supportingExchangeIds: z.array(z.string().min(1)).default([])
});

export type CitationReference = z.infer<typeof citationReferenceSchema>;
export type PlannedQuestionDraft = z.infer<typeof plannedQuestionDraftSchema>;
export type PlannedQuestion = z.infer<typeof plannedQuestionSchema>;
export type PlanningScope = z.infer<typeof planningScopeSchema>;
export type ExecutionScope = z.infer<typeof executionScopeSchema>;
export type QuestionBatch = z.infer<typeof questionBatchSchema>;
export type PlanningMode = z.infer<typeof planningModeSchema>;
export type QuestionPlanningContext = z.infer<typeof questionPlanningContextSchema>;
export type QuestionPlanningContextPreview = z.infer<typeof questionPlanningContextPreviewSchema>;
export type QAExchange = z.infer<typeof qaExchangeSchema>;
export type QARunIndex = z.infer<typeof runIndexSchema>;
export type OutputArtifact = z.infer<typeof outputArtifactSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
