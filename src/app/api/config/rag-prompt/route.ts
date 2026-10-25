import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

/**
 * API endpoint for RAG system prompt configuration
 * Handles the split interface: pre-context + post-context sections
 */

// Helper function to safely decode URL-encoded text
function safeDecodeURIComponent(text: string): string {
  if (!text) return '';

  let decoded = text;
  let previousDecoded = '';

  // Keep decoding until we stop getting changes (handles multiple encoding)
  while (decoded !== previousDecoded) {
    previousDecoded = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      console.warn('Decoding failed, stopping at:', decoded);
      break;
    }
  }

  return decoded;
}

// Helper function to prepare text for .env.local (no encoding needed)
function safeEncodeForEnv(text: string): string {
  if (!text) return '';

  // Return the text as-is, no encoding
  // The .env.local file can handle plain text
  return text;
}

// Helper function to get .env.local file path
function getEnvFilePath(): string {
  return path.join(process.cwd(), '.env.local');
}

// Helper function to parse .env.local file
async function parseEnvFile(): Promise<Record<string, string>> {
  try {
    const envFilePath = getEnvFilePath();
    const content = await fs.readFile(envFilePath, 'utf-8');
    const env: Record<string, string> = {};

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim();
          env[key] = value;
        }
      }
    }

    return env;
  } catch (error) {
    console.error('Error parsing .env.local file:', error);
    return {};
  }
}

// Helper function to update .env.local file
async function updateEnvFile(updates: Record<string, string>): Promise<void> {
  try {
    const envFilePath = getEnvFilePath();
    let content = '';

    try {
      content = await fs.readFile(envFilePath, 'utf-8');
    } catch (error) {
      console.warn('Could not read .env.local file, creating new one');
    }

    // Special handling for RAG_PRE_CONTEXT and RAG_POST_CONTEXT
    const ragKeys = ['RAG_PRE_CONTEXT', 'RAG_POST_CONTEXT'];
    const ragUpdates: Record<string, string> = {};
    const otherUpdates: Record<string, string> = {};

    // Separate RAG context updates from other updates
    for (const [key, value] of Object.entries(updates)) {
      if (ragKeys.includes(key)) {
        ragUpdates[key] = value;
      } else {
        otherUpdates[key] = value;
      }
    }

    // Update non-RAG context variables first
    for (const [key, value] of Object.entries(otherUpdates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(content)) {
        content = content.replace(regex, newLine);
      } else {
        if (!content.endsWith('\n')) content += '\n';
        content += `${newLine}\n`;
      }
    }

    // Handle RAG context variables - place them after RAG_SYSTEM_PROMPT
    for (const [key, value] of Object.entries(ragUpdates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(content)) {
        // Variable exists, update it in place
        content = content.replace(regex, newLine);
      } else {
        // Variable doesn't exist, add it after RAG_SYSTEM_PROMPT
        const ragPromptRegex = /^RAG_SYSTEM_PROMPT=.*$/m;
        const match = content.match(ragPromptRegex);

        if (match) {
          // Find the position after RAG_SYSTEM_PROMPT line
          const matchIndex = match.index! + match[0].length;
          // Insert the new variable after RAG_SYSTEM_PROMPT with a newline
          content = content.slice(0, matchIndex) + '\n' + newLine + content.slice(matchIndex);
        } else {
          // RAG_SYSTEM_PROMPT doesn't exist, append at the end as fallback
          if (!content.endsWith('\n')) content += '\n';
          content += `${newLine}\n`;
        }
      }
    }

    await fs.writeFile(envFilePath, content, 'utf-8');
  } catch (error) {
    console.error('Error updating .env.local file:', error);
    throw new Error('Failed to update .env.local file');
  }
}

// Helper function to split existing RAG_SYSTEM_PROMPT into pre/post context
function splitExistingPrompt(ragSystemPrompt: string): { preContext: string; postContext: string } {
  if (!ragSystemPrompt) {
    return { preContext: '', postContext: '' };
  }

  // Look for {{context}} placeholder
  const contextIndex = ragSystemPrompt.indexOf('{{context}}');

  if (contextIndex === -1) {
    // No {{context}} found, treat entire prompt as pre-context
    return { preContext: ragSystemPrompt, postContext: '' };
  }

  // Split around {{context}}
  const preContext = ragSystemPrompt.substring(0, contextIndex).trim();
  const postContext = ragSystemPrompt.substring(contextIndex + '{{context}}'.length).trim();

  return { preContext, postContext };
}

// Helper function to assemble complete prompt from pre/post context
function assemblePrompt(preContext: string, postContext: string): string {
  const parts = [];

  if (preContext.trim()) {
    parts.push(preContext.trim());
  }

  parts.push('{{context}}');

  if (postContext.trim()) {
    parts.push(postContext.trim());
  }

  // Join with actual newlines, then escape them for .env.local format
  const assembled = parts.join('\n\n');
  return assembled.replace(/\n/g, '\\n');
}

export async function GET(request: NextRequest) {
  try {
    const env = await parseEnvFile();

    // First, try to get from RAG_PRE_CONTEXT and RAG_POST_CONTEXT
    let preContext = '';
    let postContext = '';

    if (env.RAG_PRE_CONTEXT) {
      preContext = safeDecodeURIComponent(env.RAG_PRE_CONTEXT);
      // Convert escaped newlines back to actual newlines for display
      preContext = preContext.replace(/\\n/g, '\n');
    }

    if (env.RAG_POST_CONTEXT) {
      postContext = safeDecodeURIComponent(env.RAG_POST_CONTEXT);
      // Convert escaped newlines back to actual newlines for display
      postContext = postContext.replace(/\\n/g, '\n');
    }

    // If both are empty, try to parse from existing RAG_SYSTEM_PROMPT
    if (!preContext && !postContext && env.RAG_SYSTEM_PROMPT) {
      let decodedPrompt = safeDecodeURIComponent(env.RAG_SYSTEM_PROMPT);
      // Convert escaped newlines back to actual newlines
      decodedPrompt = decodedPrompt.replace(/\\n/g, '\n');
      const split = splitExistingPrompt(decodedPrompt);
      preContext = split.preContext;
      postContext = split.postContext;

      // If we successfully split an existing prompt, save the split version
      if (preContext || postContext) {
        const updates: Record<string, string> = {};
        if (preContext) updates.RAG_PRE_CONTEXT = preContext;
        if (postContext) updates.RAG_POST_CONTEXT = postContext;

        try {
          await updateEnvFile(updates);
        } catch (error) {
          console.warn('Could not save split prompt to .env.local:', error);
        }
      }
    }

    // Assemble the complete prompt for preview
    const assembledPrompt = assemblePrompt(preContext, postContext);

    return NextResponse.json({
      success: true,
      preContext,
      postContext,
      assembledPrompt,
      warning: (!preContext && !postContext) ? 'No system prompt configuration found' : undefined
    });
  } catch (error) {
    console.error('Error getting RAG prompt configuration:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get RAG prompt configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { preContext, postContext } = body;

    if (!preContext || typeof preContext !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Pre-context instructions are required' },
        { status: 400 }
      );
    }

    if (postContext && typeof postContext !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Post-context must be a string' },
        { status: 400 }
      );
    }

    // Prepare updates for .env.local
    const updates: Record<string, string> = {};

    // Save individual sections with escaped newlines for .env.local format
    // The system assembles the prompt as: PRE_CONTEXT + {{context}} + POST_CONTEXT
    updates.RAG_PRE_CONTEXT = preContext.replace(/\n/g, '\\n');
    if (postContext) {
      updates.RAG_POST_CONTEXT = postContext.replace(/\n/g, '\\n');
    }

    // Assemble prompt for response (not saved to env file)
    const assembledPrompt = assemblePrompt(preContext, postContext || '');

    await updateEnvFile(updates);

    return NextResponse.json({
      success: true,
      message: 'RAG prompt configuration saved successfully',
      preContext,
      postContext: postContext || '',
      assembledPrompt
    });
  } catch (error) {
    console.error('Error saving RAG prompt configuration:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save RAG prompt configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS request for CORS
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}