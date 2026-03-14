import { ZodSchema } from 'zod';

export function validateOrThrow<T>(schema: ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const error = new Error('VALIDATION_ERROR');
    // Attach issues for higher-level error handling / logging
    (error as any).issues = result.error.issues;
    throw error;
  }
  return result.data;
}

