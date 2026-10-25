import type { ToolCallPart } from 'ai';

/**
 * Generates descriptive titles from tool call data
 * @param toolCall The tool call part from the AI SDK
 * @returns A human-readable title describing the tool action
 */
export function generateChatTitleFromToolCall(toolCall: ToolCallPart): string {
  const { toolName, args } = toolCall;
  let parsedArgs: any = {};

  try {
    if (typeof args === 'string') {
      parsedArgs = JSON.parse(args);
    } else {
      parsedArgs = args;
    }
  } catch (error) {
    console.warn('Failed to parse tool arguments for title generation:', error);
    // Fallback to using the raw tool name if args parsing fails
    const formattedName = toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return `Tool: ${formattedName}`;
  }

  switch (toolName) {
    // Gmail tools - handle both full MCP names and base names
    case 'mcp_Zapier_gmail_find_email':
    case 'gmail_find_email':
      return `Email Search: ${parsedArgs?.instructions?.substring(0, 35) || 'Recent emails'}`;
    
    case 'mcp_Zapier_gmail_send_email':
    case 'gmail_send_email': {
      const to = parsedArgs?.to || 'Unknown';
      const subject = parsedArgs?.subject || 'No Subject';
      const recipient = to.split(',')[0].substring(0, 15);
      const shortSubject = subject.substring(0, 20);
      return `Email Sent: ${recipient} (${shortSubject}${shortSubject.length < subject.length ? '...' : ''})`;
    }
    
    case 'mcp_Zapier_gmail_create_draft':
    case 'gmail_create_draft': {
      const to = parsedArgs?.to || 'Unknown';
      const subject = parsedArgs?.subject || 'No Subject';
      const recipient = to.split(',')[0].substring(0, 15);
      const shortSubject = subject.substring(0, 20);
      return `Email Draft: ${recipient} (${shortSubject}${shortSubject.length < subject.length ? '...' : ''})`;
    }
    
    case 'mcp_Zapier_gmail_reply_to_email':
    case 'gmail_reply_to_email': {
      const to = parsedArgs?.to || 'Unknown';
      const recipient = to.split(',')[0].substring(0, 15);
      return `Email Reply: To ${recipient}`;
    }
    
    case 'mcp_Zapier_gmail_create_draft_reply':
    case 'gmail_create_draft_reply': {
      const to = parsedArgs?.to || 'Unknown';
      const recipient = to.split(',')[0].substring(0, 15);
      return `Email Draft Reply: To ${recipient}`;
    }
    
    case 'mcp_Zapier_gmail_delete_email':
    case 'gmail_delete_email':
      return `Email Deleted`;
    
    case 'mcp_Zapier_gmail_archive_email':
    case 'gmail_archive_email':
      return `Email Archived`;
    
    // Calendar tools - handle both full MCP names and base names  
    case 'mcp_Zapier_google_calendar_quick_add_event':
    case 'google_calendar_quick_add_event': {
      const eventText = parsedArgs?.text || 'New Event';
      const shortText = eventText.substring(0, 30);
      return `Calendar Add: "${shortText}${shortText.length < eventText.length ? '...' : ''}"`;
    }
    
    case 'mcp_Zapier_google_calendar_find_event':
    case 'google_calendar_find_event': {
      const searchTerm = parsedArgs?.search_term || parsedArgs?.instructions || 'Events';
      return `Calendar Search: ${searchTerm.substring(0, 25)}`;
    }
    
    case 'mcp_brave-search_brave_web_search': {
      const query = parsedArgs?.query || 'Web search';
      return `Web Search: ${query.substring(0, 30)}`;
    }
    
    case 'mcp_brave-search_brave_local_search': {
      const query = parsedArgs?.query || 'Local search';
      return `Local Search: ${query.substring(0, 30)}`;
    }
    
    case 'web_search': {
      const searchTerm = parsedArgs?.search_term || 'Web search';
      return `Web Search: ${searchTerm.substring(0, 30)}`;
    }
    
    case 'mcp_supabase_query': {
      const sql = parsedArgs?.sql || '';
      const operation = sql.trim().split(' ')[0]?.toUpperCase() || 'Query';
      return `Database ${operation}`;
    }
    
    case 'mcp_21st-dev-magic-mcp_21st_magic_component_builder': {
      const context = parsedArgs?.context || 'UI Component';
      return `UI Builder: ${context.substring(0, 25)}`;
    }
    
    case 'mcp_21st-dev-magic-mcp_21st_magic_component_refiner': {
      const context = parsedArgs?.context || 'UI Refinement';
      return `UI Refine: ${context.substring(0, 25)}`;
    }
    
    case 'mcp_21st-dev-magic-mcp_logo_search': {
      const queries = parsedArgs?.queries || [];
      const firstQuery = queries[0] || 'Logo';
      return `Logo Search: ${firstQuery}`;
    }
    
    case 'mcp_context7_get-library-docs': {
      const libraryId = parsedArgs?.context7CompatibleLibraryID || 'Library';
      const libraryName = libraryId.split('/').pop() || libraryId;
      return `Docs: ${libraryName}`;
    }
    
    case 'codebase_search': {
      const query = parsedArgs?.query || 'Code search';
      return `Code Search: ${query.substring(0, 25)}`;
    }
    
    case 'file_search': {
      const query = parsedArgs?.query || 'File search';
      return `File Search: ${query.substring(0, 25)}`;
    }
    
    case 'grep_search': {
      const query = parsedArgs?.query || 'Text search';
      return `Text Search: ${query.substring(0, 25)}`;
    }
    
    case 'read_file': {
      const targetFile = parsedArgs?.target_file || 'File';
      const fileName = targetFile.split('/').pop() || targetFile;
      return `Read File: ${fileName}`;
    }
    
    case 'edit_file': {
      const targetFile = parsedArgs?.target_file || 'File';
      const fileName = targetFile.split('/').pop() || targetFile;
      return `Edit File: ${fileName}`;
    }
    
    case 'run_terminal_cmd': {
      const command = parsedArgs?.command || 'Terminal command';
      const shortCommand = command.split(' ')[0] || command;
      return `Terminal: ${shortCommand}`;
    }
    
    // Add more cases for other tools as they are implemented
    default: {
      // Generic handler for unknown tools
      const formattedName = toolName
        .replace(/^mcp_/i, '') // Remove mcp_ prefix
        .replace(/_/g, ' ')     // Replace underscores with spaces
        .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
      return `Tool: ${formattedName}`;
    }
  }
}

/**
 * Checks if a message content contains a tool call approval request
 * @param content The message content (string or ContentPart array)
 * @returns Boolean indicating if this is a tool approval request
 */
export function isToolApprovalRequest(content: string | any[]): boolean {
  if (typeof content === 'string') {
    return content.includes('__REQUIRES_APPROVAL__:');
  }
  
  if (Array.isArray(content)) {
    return content.some(part => 
      part.type === 'text' && 
      part.text && 
      part.text.includes('__REQUIRES_APPROVAL__:')
    );
  }
  
  return false;
}

/**
 * Extracts tool call information from approval request content
 * @param content The message content containing the approval request
 * @returns Object with toolCallId and toolName, or null if not found
 */
export function extractToolCallInfo(content: string | any[]): { toolCallId: string; toolName: string } | null {
  let textContent = '';
  
  if (typeof content === 'string') {
    textContent = content;
  } else if (Array.isArray(content)) {
    const textPart = content.find(part => 
      part.type === 'text' && 
      part.text && 
      part.text.includes('__REQUIRES_APPROVAL__:')
    );
    if (textPart) {
      textContent = textPart.text;
    }
  }
  
  if (!textContent) {
    return null;
  }
  
  // Extract toolCallId and toolName from the format: __REQUIRES_APPROVAL__:toolCallId:toolName
  const match = textContent.match(/__REQUIRES_APPROVAL__:([^:,\s\}"]+):([^:,\s\}"]+)/);
  
  if (match) {
    return {
      toolCallId: match[1],
      toolName: match[2]
    };
  }
  
  return null;
} 