import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v3';

/**
 * Middleware for validating request body with Zod schemas
 * @param req The Next.js request
 * @param schema The Zod schema to validate against
 * @returns Result containing either validated data or error response
 */
export async function validateRequest<T extends z.ZodType>(
  req: NextRequest,
  schema: T
): Promise<{ success: true; data: z.infer<T> } | { success: false; response: NextResponse }> {
  try {
    // Parse and validate the request body against the schema
    const body = await req.json();
    const result = schema.safeParse(body);
    
    if (!result.success) {
      console.error('API validation failed:', result.error.errors);
      return {
        success: false,
        response: NextResponse.json(
          {
            success: false,
            error: 'Invalid request data',
            details: result.error.errors.map(e => ({
              path: e.path.join('.'),
              message: e.message
            }))
          },
          { status: 400 }
        )
      };
    }
    
    return {
      success: true,
      data: result.data
    };
  } catch (error) {
    console.error('API middleware error:', error);
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'Failed to parse request body',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 400 }
      )
    };
  }
}

/**
 * Create a handler that validates the request body against a schema
 * @param schema The Zod schema to validate against
 * @param handler The handler to call with the validated data
 * @returns A new handler function with built-in validation
 */
export function withValidation<T extends z.ZodType>(
  schema: T,
  handler: (req: NextRequest, data: z.infer<T>) => Promise<NextResponse> | NextResponse
) {
  return async (req: NextRequest) => {
    const result = await validateRequest(req, schema);
    
    if (!result.success) {
      return result.response;
    }
    
    return handler(req, result.data);
  };
} 