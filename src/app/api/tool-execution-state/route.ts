import { NextRequest, NextResponse } from 'next/server';
import { ToolExecutionStateService } from '@/lib/tool-execution-state';

/**
 * Transform tool parameters for better compatibility with MCP clients
 * This function applies transformations BEFORE storing in persistent state
 */
function transformToolParameters(toolName: string, originalParams: any): any {
  let optimizedParams = { ...originalParams };

  // 🎯 CRITICAL FIX: Transform instructions → query for Gmail find_email tools
  // The Zapier MCP client expects 'query' parameter, but AI sends 'instructions'
  if (toolName.includes('find_email') && optimizedParams.instructions && !optimizedParams.query) {
    console.log('🔍 [PARAM TRANSFORM] Converting instructions to query parameter for Gmail find_email');
    console.log('🔍 [PARAM TRANSFORM] Original instructions:', optimizedParams.instructions);
    
    // Transform instructions to Gmail search query
    let searchQuery = optimizedParams.instructions;
    
    // Add default search scope if not specified
    if (!searchQuery.includes('in:') && !searchQuery.includes('from:') && !searchQuery.includes('subject:')) {
      // For general queries like "find my recent emails", add in:inbox
      if (searchQuery.toLowerCase().includes('recent') || searchQuery.toLowerCase().includes('latest') || searchQuery.toLowerCase().includes('last')) {
        searchQuery = 'in:inbox';
      }
    }
    
    // 🎯 PARAMETER ORDER FIX: Force explicit property order using Object.defineProperty
    const instructions = optimizedParams.instructions;
    optimizedParams = {};
    
    // Define properties in explicit order
    Object.defineProperty(optimizedParams, 'instructions', {
      value: instructions,
      writable: true,
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(optimizedParams, 'query', {
      value: searchQuery,
      writable: true,
      enumerable: true,
      configurable: true
    });
    
    console.log('🔍 [PARAM TRANSFORM] Transformed query:', searchQuery);
    console.log('🔍 [PARAM TRANSFORM] Final parameter count:', Object.keys(optimizedParams).length);
    console.log('🔍 [PARAM TRANSFORM] Parameter order:', Object.keys(optimizedParams));
    console.log('🔍 [PARAM TRANSFORM] Final object JSON:', JSON.stringify(optimizedParams, null, 2));
  }

  return optimizedParams;
}

  export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chat_id, message_id, tool_call_id, tool_name, tool_params } = body;

    if (!chat_id || !message_id || !tool_call_id || !tool_name) {
      return NextResponse.json(
        { error: 'Missing required fields: chat_id, message_id, tool_call_id, tool_name' },
        { status: 400 }
      );
    }

    console.log('[API] Creating tool execution state:', { chat_id, message_id, tool_call_id, tool_name });
    
    // 🎯 CRITICAL FIX: Apply parameter transformation before creating persistent state
    const transformedParams = transformToolParameters(tool_name, tool_params || {});
    console.log('[API] 🔍 Parameter transformation applied:', {
      original: tool_params,
      transformed: transformedParams,
      originalCount: Object.keys(tool_params || {}).length,
      transformedCount: Object.keys(transformedParams).length
    });

    const state = await ToolExecutionStateService.create({
      chat_id,
      message_id,
      tool_call_id,
      tool_name,
      tool_params: transformedParams
    });

    if (!state) {
      return NextResponse.json(
        { error: 'Failed to create tool execution state' },
        { status: 500 }
      );
    }

    console.log('[API] Successfully created tool execution state:', state.id);
    return NextResponse.json(state);
  } catch (error) {
    console.error('[API] Error creating tool execution state:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tool_call_id = searchParams.get('tool_call_id');
    const chat_id = searchParams.get('chat_id');
    const message_id = searchParams.get('message_id');

    if (tool_call_id) {
      // Get by tool call ID
      let state = await ToolExecutionStateService.getByToolCallId(tool_call_id);
      
      // 🎯 CRITICAL FIX: If no persistent state exists, check global toolApprovalState
      if (!state) {
        console.log(`[API] No persistent state found for ${tool_call_id}, checking global state...`);
        
        const global = globalThis as any;
        if (global.toolApprovalState && global.toolApprovalState[tool_call_id]) {
          const globalToolCall = global.toolApprovalState[tool_call_id].toolCall;
          console.log(`[API] Found global state for ${tool_call_id}:`, globalToolCall);
          
          // Create persistent state from global state
          if (globalToolCall) {
            // 🎯 CRITICAL FIX: Apply parameter transformation before creating persistent state from global state
            const transformedParams = transformToolParameters(globalToolCall.name || 'unknown_tool', globalToolCall.params || {});
            console.log(`[API] 🔍 Global state parameter transformation:`, {
              toolName: globalToolCall.name,
              original: globalToolCall.params,
              transformed: transformedParams,
              originalCount: Object.keys(globalToolCall.params || {}).length,
              transformedCount: Object.keys(transformedParams).length
            });
            
            state = await ToolExecutionStateService.create({
              chat_id: '00000000-0000-0000-0000-000000000000', // Placeholder UUID
              message_id: Date.now(),
              tool_call_id: tool_call_id,
              tool_name: globalToolCall.name || 'unknown_tool',
              tool_params: transformedParams
            });
            
            if (state) {
              console.log(`[API] Created persistent state from global state: ${state.id}`);
              console.log(`[API] Stored transformed parameters:`, state.tool_params);
            }
          }
        } else {
          console.log(`[API] No global state found for ${tool_call_id}`);
        }
      }
      
      return NextResponse.json(state);
    } else if (chat_id && message_id) {
      // Get by message ID
      const states = await ToolExecutionStateService.getByMessageId(chat_id, parseInt(message_id));
      return NextResponse.json(states);
    } else if (chat_id) {
      // Get by chat ID
      const states = await ToolExecutionStateService.getByChatId(chat_id);
      return NextResponse.json(states);
    } else {
      return NextResponse.json(
        { error: 'Missing required parameter: tool_call_id, chat_id, or message_id' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[API] Error getting tool execution state:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { tool_call_id, ...updates } = body;

    if (!tool_call_id) {
      return NextResponse.json(
        { error: 'Missing required field: tool_call_id' },
        { status: 400 }
      );
    }

    console.log('[API] Updating tool execution state:', { tool_call_id, updates });

    const state = await ToolExecutionStateService.update(tool_call_id, updates);

    if (!state) {
      return NextResponse.json(
        { error: 'Tool execution state not found or failed to update' },
        { status: 404 }
      );
    }

    console.log('[API] Successfully updated tool execution state');
    return NextResponse.json(state);
  } catch (error) {
    console.error('[API] Error updating tool execution state:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 