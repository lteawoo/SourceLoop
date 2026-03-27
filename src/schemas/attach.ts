import { z } from "zod";

const attachTargetBaseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("chrome_attach_target"),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: z.string().datetime()
});

export const chromeProfileAttachTargetSchema = attachTargetBaseSchema.extend({
  targetType: z.literal("profile"),
  profileDirPath: z.string().min(1),
  chromeExecutablePath: z.string().min(1).optional(),
  launchArgs: z.array(z.string()).default([]),
  remoteDebuggingPort: z.number().int().positive().optional()
});

export const chromeEndpointAttachTargetSchema = attachTargetBaseSchema.extend({
  targetType: z.literal("remote_debugging_endpoint"),
  endpoint: z.string().url()
});

export const chromeAttachTargetSchema = z.discriminatedUnion("targetType", [
  chromeProfileAttachTargetSchema,
  chromeEndpointAttachTargetSchema
]);

export type ChromeAttachTarget = z.infer<typeof chromeAttachTargetSchema>;
export type ChromeProfileAttachTarget = z.infer<typeof chromeProfileAttachTargetSchema>;
export type ChromeEndpointAttachTarget = z.infer<typeof chromeEndpointAttachTargetSchema>;
