'use client';

import * as React from 'react';
import { useState } from 'react';
import { Check, FileX, Loader2, ChevronsUpDown, X, Clock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { type ToolExecutionState } from '@/lib/tool-execution-state';
import { formatToolResultUniversally } from '@/lib/universal-tool-formatter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Local type definitions bridging AI SDK v6 with legacy code expectations.
 * AI SDK v6 changed:
 * - ToolCallPart.args -> ToolCallPart.input
 * - ToolResultPart.result -> ToolResultPart.output
 * - ToolResultPart.isError was removed
 * 
 * These local types provide backwards compatibility.
 */

// Extended ToolCallPart that supports both 'input' (v6) and 'args' (legacy)
interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  args?: unknown; // Legacy alias for input
  providerOptions?: Record<string, unknown>;
}

// Extended ToolResultPart that supports both 'output' (v6) and 'result' (legacy)
interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: unknown;
  result?: unknown; // Legacy alias for output
  isError?: boolean; // Legacy error indicator
  providerOptions?: Record<string, unknown>;
}

interface McpToolBoxProps {
  toolCall: ToolCallPart;
  toolResult?: ToolResultPart;
  onApprove?: () => void;
  onCancel?: () => void;
  requireExplicitApproval?: boolean;
  initialExplanationText?: string; // New prop to directly pass explanation text
  persistentState?: ToolExecutionState | null; // Persistent tool execution state
  isApproved?: boolean; // 🎯 CRITICAL FIX: Add missing isApproved prop to receive immediate approval state
  isCancelled?: boolean; // 🎯 CRITICAL FIX: Add missing isCancelled prop to receive immediate cancellation state
  sessionId?: string; // Session ID for accessing image context and parameter enhancement
}

/**
 * Enhanced Tool Result Renderer with Markdown Support
 * 
 * This component intelligently renders tool results with proper markdown formatting
 * when available, falling back to JSON display for complex data structures.
 */
function ToolResultRenderer({ data, toolName, isError }: {
  data: any;
  toolName: string;
  isError: boolean;
}) {
  const [renderMode, setRenderMode] = React.useState<'auto' | 'markdown' | 'json'>('auto');

  // First, try to format with universal formatter
  const formattedResult = React.useMemo(() => {
    try {
      return formatToolResultUniversally(data, toolName);
    } catch (error) {
      console.error('[ToolResultRenderer] Error formatting with universal formatter:', error);
      return {
        markdown: JSON.stringify(data, null, 2),
        hasRichContent: false,
        contentType: 'json'
      };
    }
  }, [data, toolName]);

  // Determine the best display mode
  const shouldUseMarkdown = renderMode === 'markdown' ||
    (renderMode === 'auto' && formattedResult.hasRichContent &&
      formattedResult.markdown !== JSON.stringify(data, null, 2));

  const toggleMode = () => {
    if (renderMode === 'auto') {
      setRenderMode(shouldUseMarkdown ? 'json' : 'markdown');
    } else if (renderMode === 'markdown') {
      setRenderMode('json');
    } else {
      setRenderMode('markdown');
    }
  };

  // Show mode toggle button only if we have meaningful markdown vs JSON difference
  const showToggle = formattedResult.hasRichContent &&
    formattedResult.markdown !== JSON.stringify(data, null, 2);

  return (
    <div className="space-y-2">
      {/* Mode Toggle Button */}
      {showToggle && (
        <div className="flex justify-end">
          <button
            onClick={toggleMode}
            className={cn(
              "px-2 py-1 text-xs rounded border transition-colors",
              "text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600",
              "hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            )}
          >
            {shouldUseMarkdown ? '📄 Raw JSON' : '🎨 Formatted'}
          </button>
        </div>
      )}

      {/* Content Display */}
      <div className={cn(
        "rounded-lg p-3 border overflow-x-auto",
        isError
          ? "border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20"
          : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
      )}>
        {shouldUseMarkdown ? (
          <div className={cn(
            "prose prose-sm max-w-none",
            "prose-gray dark:prose-invert",
            "prose-pre:bg-gray-100 dark:prose-pre:bg-gray-800",
            "prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:rounded",
            isError ? "prose-red dark:prose-red" : ""
          )}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {formattedResult.markdown}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className={cn(
            "text-xs font-mono whitespace-pre-wrap",
            isError
              ? "text-red-700 dark:text-red-300"
              : "text-gray-700 dark:text-gray-300"
          )}>
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>

      {/* Debug Information (only in development) */}
      {process.env.NODE_ENV === 'development' && (
        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
            Debug Info
          </summary>
          <div className="mt-1 space-y-1">
            <div>Content Type: {formattedResult.contentType}</div>
            <div>Has Rich Content: {formattedResult.hasRichContent ? 'Yes' : 'No'}</div>
            <div>Render Mode: {renderMode} → {shouldUseMarkdown ? 'Markdown' : 'JSON'}</div>
            <div>Markdown Length: {formattedResult.markdown.length} chars</div>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Format Gmail email data into a readable, user-friendly string
 */
function formatGmailData(data: any): string {
  try {
    console.log(`[McpToolBox] Gmail data type:`, typeof data, data);

    // If data is a plain string (likely explanation text), return it directly
    if (typeof data === 'string' &&
      !data.includes('raw__payload') &&
      !data.startsWith('[') &&
      !data.startsWith('{')) {
      return data;
    }

    // For array of emails
    if (Array.isArray(data)) {
      return formatGmailEmailArray(data);
    }

    // Check if data is in the nested format with a content array containing stringified JSON
    if (data?.content && Array.isArray(data.content)) {
      const textPart = data.content.find((part: any) => part.type === 'text');
      if (textPart && textPart.text) {
        try {
          // If it's clearly not JSON, return it directly
          if (!textPart.text.startsWith('{') && !textPart.text.startsWith('[')) {
            return textPart.text;
          }

          // Try to parse the stringified JSON in the text property
          const parsedData = JSON.parse(textPart.text);
          // Now format the parsed data
          if (Array.isArray(parsedData)) {
            return formatGmailEmailArray(parsedData);
          }
          // Handle single email object
          return formatGmailEmailArray([parsedData]);
        } catch (e) {
          console.log(`[McpToolBox] Error parsing Gmail content text:`, e);
          return textPart.text; // Return as-is if parsing fails
        }
      }
    }

    // Handle single email object
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return formatGmailEmailArray([data]);
    }

    // Fallback: return as JSON string
    return JSON.stringify(data, null, 2);
  } catch (e) {
    console.error(`[McpToolBox] Error formatting Gmail data:`, e);
    return String(data);
  }
}

/**
 * Format an array of Gmail emails with improved formatting and readability
 */
function formatGmailEmailArray(emailsArray: any[]): string {
  // If no emails found
  if (!emailsArray || emailsArray.length === 0 || (emailsArray.length === 1 && emailsArray[0]._zap_search_was_found_status === false)) {
    return "No emails found matching your search criteria.";
  }

  // Add a summary header if multiple emails found
  let header = '';
  if (emailsArray.length > 1) {
    header = `Found ${emailsArray.length} email${emailsArray.length > 1 ? 's' : ''}\n\n`;
  }

  // Format each email with improved styling
  const formattedEmails = emailsArray.map((email, index) => {
    console.log('[McpToolBox] Processing email:', email);

    // Extract email properties with better fallback handling
    const subject = email.subject || email.raw__payload__headers__Subject || '';
    const from = extractEmailSender(email);
    const date = formatEmailDate(email.date || email.raw__payload__headers__Date || '');
    const to = formatEmailRecipients(email);
    const snippet = (email.raw__snippet || email.snippet || email.body_plain || '').trim();

    // Extract and format body content if available
    let body = '';
    if (email.body_plain && email.body_plain.length > 0) {
      // Format the plain text body - ensure it's not too long
      const maxBodyLength = 500;
      const fullBody = email.body_plain.replace(/\n{3,}/g, '\n\n').trim();
      body = fullBody.length > maxBodyLength
        ? `${fullBody.substring(0, maxBodyLength)}...\n[Email truncated, full content available in response]`
        : fullBody;
    } else if (snippet.length > 0) {
      body = snippet;
    }

    // Format attachments if available
    let attachments = '';
    const attachmentCount = email.attachment_count || 0;
    const attachmentNames = email.attachments || [];

    if (attachmentCount > 0) {
      attachments = `\n📎 Attachments: ${attachmentCount} file${attachmentCount > 1 ? 's' : ''}`;

      // Add attachment names if available
      if (Array.isArray(attachmentNames) && attachmentNames.length > 0) {
        attachments += `\n   ${attachmentNames.map((a: any) => a.name || a.filename || 'Untitled').join('\n   ')}`;
      }
    }

    // Get labels/categories if available
    const labels = email.labels || email.labelIds || [];
    let labelText = '';
    if (Array.isArray(labels) && labels.length > 0) {
      labelText = `\n🏷️ Labels: ${labels.join(', ')}`;
    }

    // Determine email importance
    const isImportant = (Array.isArray(labels) && (labels.includes('IMPORTANT') || labels.includes('important'))) ||
      email.important === true;

    // Build a styled email card
    return [
      `${index > 0 ? '\n' : ''}${isImportant ? '🔴 ' : ''}📧 ${subject ? subject : 'No Subject'}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 From: ${from || 'Unknown Sender'}`,
      `👥 To: ${to || 'Unknown Recipient'}`,
      `🕒 Date: ${date || 'Unknown Date'}${labelText}`,
      '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈',
      body ? `${body}` : '(No content available)',
      attachments,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
  }).join('\n\n');

  return header + formattedEmails;
}

/**
 * Helper function to extract a well-formatted sender name and email
 */
function extractEmailSender(email: any): string {
  // Try to extract the sender information from various possible locations
  let fromName = '';
  let fromEmail = '';

  // Check for structured format first
  if (email.from__name) fromName = email.from__name;
  if (email.from__email) fromEmail = email.from__email;

  // If we have both name and email, format them
  if (fromName && fromEmail) {
    return `${fromName} <${fromEmail}>`;
  }

  // Check for combined format in from field
  if (email.from) {
    // Try to parse "Name <email>" format
    const fromMatch = email.from.match(/^([^<]+)<([^>]+)>$/);
    if (fromMatch) {
      fromName = fromMatch[1].trim();
      fromEmail = fromMatch[2].trim();
      return `${fromName} <${fromEmail}>`;
    }

    // Return as-is if no pattern match
    return email.from;
  }

  // Check headers as fallback
  if (email.raw__payload__headers__From) {
    return email.raw__payload__headers__From;
  }

  // Last resort - if we have just email or just name
  if (fromEmail) return fromEmail;
  if (fromName) return fromName;

  return 'Unknown Sender';
}

/**
 * Helper function to format email recipients list
 */
function formatEmailRecipients(email: any): string {
  // Check for structured recipient array first
  if (email.to__emails) {
    if (Array.isArray(email.to__emails)) {
      if (email.to__emails.length <= 3) {
        return email.to__emails.join(', ');
      } else {
        // Truncate if too many recipients
        return `${email.to__emails.slice(0, 3).join(', ')} + ${email.to__emails.length - 3} more`;
      }
    }
    return email.to__emails;
  }

  // Check for 'to' field
  if (email.to) {
    return email.to;
  }

  // Check headers as fallback
  if (email.raw__payload__headers__To) {
    const recipients = email.raw__payload__headers__To.split(', ');
    if (recipients.length <= 3) {
      return recipients.join(', ');
    } else {
      return `${recipients.slice(0, 3).join(', ')} + ${recipients.length - 3} more`;
    }
  }

  return 'Unknown Recipient';
}

/**
 * Helper function to format email date
 */
function formatEmailDate(dateStr: string): string {
  if (!dateStr) return '';

  try {
    // Try to parse the date string
    const date = new Date(dateStr);

    // Check if valid date
    if (isNaN(date.getTime())) {
      return dateStr; // Return original if invalid
    }

    // Format to a friendly representation
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Format based on how recent the message is
    if (diffDays === 0) {
      // Today - show time
      return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      // Yesterday
      return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      // This week
      return `${diffDays} days ago (${date.toLocaleDateString()})`;
    } else {
      // Older - show full date
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  } catch (e) {
    // If date parsing fails, return the original string
    return dateStr;
  }
}

/**
 * Format Google Calendar event data into a readable, visually appealing string
 */
function formatCalendarData(data: any): string {
  console.log(`[McpToolBox] Formatting calendar data (type: ${typeof data}):`, data);

  // Special case for the direct Google Calendar API response format from Zapier
  // This is to match the exact format we saw in the logs
  if (data && typeof data === 'object' && data.results && Array.isArray(data.results)) {
    console.log(`[McpToolBox] Direct match for Zapier response format with ${data.results.length} events in results array`);

    // Empty results case - most likely cause of the "no events" problem
    if (data.results.length === 0) {
      return "No calendar events found matching your search criteria.";
    }

    // Check if these are calendar events by looking at the first one
    if (data.results[0] && typeof data.results[0] === 'object' &&
      (data.results[0].kind === 'calendar#event' || data.results[0].summary)) {
      console.log(`[McpToolBox] Found calendar events in results array, sending to handler`);
      return handleCalendarEventArray(data.results);
    }
  }

  // Special case for the execution.result format from Zapier
  if (data && typeof data === 'object' &&
    data.execution && data.execution.result &&
    Array.isArray(data.execution.result)) {
    console.log(`[McpToolBox] Found execution.result array with ${data.execution.result.length} events`);

    // Empty results case
    if (data.execution.result.length === 0) {
      return "No calendar events found matching your search criteria.";
    }

    return handleCalendarEventArray(data.execution.result);
  }

  // Check for nested content structure first
  if (data?.content && Array.isArray(data.content)) {
    const textPart = data.content.find((part: any) => part.type === 'text');
    if (textPart && textPart.text) {
      try {
        // If it's clearly not JSON, return it directly
        if (!textPart.text.startsWith('{') && !textPart.text.startsWith('[')) {
          return textPart.text;
        }

        // Try to parse the stringified JSON in the text property
        const parsedData = JSON.parse(textPart.text);
        console.log(`[McpToolBox] Successfully parsed calendar JSON from text property:`, parsedData);

        // Check for nested results from Zapier format
        if (parsedData.results && Array.isArray(parsedData.results)) {
          console.log(`[McpToolBox] Found nested results array in Zapier response with ${parsedData.results.length} events`);

          // Empty results case
          if (parsedData.results.length === 0) {
            return "No calendar events found matching your search criteria.";
          }

          return handleCalendarEventArray(parsedData.results);
        }

        // Check for execution.result format from Zapier
        if (parsedData.execution && parsedData.execution.result && Array.isArray(parsedData.execution.result)) {
          console.log(`[McpToolBox] Found execution.result array in Zapier response with ${parsedData.execution.result.length} events`);

          // Empty results case
          if (parsedData.execution.result.length === 0) {
            return "No calendar events found matching your search criteria.";
          }

          return handleCalendarEventArray(parsedData.execution.result);
        }

        // If an array, process it as multiple events or a multi-part event
        if (Array.isArray(parsedData)) {
          return handleCalendarEventArray(parsedData);
        }

        // Single event object
        return formatSingleCalendarEvent(parsedData);
      } catch (e) {
        console.log(`[McpToolBox] Error parsing Calendar content text:`, e);
        return textPart.text; // Return as-is if parsing fails
      }
    }
  }

  // If data is an array, handle it as multiple events or a multi-part event
  if (Array.isArray(data)) {
    return handleCalendarEventArray(data);
  }

  // Handle plain string data
  if (typeof data === 'string') {
    // If it doesn't look like JSON, return it directly
    if (!data.startsWith('{') && !data.startsWith('[')) {
      return data;
    }

    // Try to parse it as JSON
    try {
      const parsedData = JSON.parse(data);
      console.log(`[McpToolBox] Successfully parsed calendar string to JSON:`, parsedData);

      // Check for nested results from Zapier format
      if (parsedData.results && Array.isArray(parsedData.results)) {
        console.log(`[McpToolBox] Found nested results array in string with ${parsedData.results.length} events`);
        return handleCalendarEventArray(parsedData.results);
      }

      // Check for execution.result format from Zapier
      if (parsedData.execution && parsedData.execution.result && Array.isArray(parsedData.execution.result)) {
        console.log(`[McpToolBox] Found execution.result array in string with ${parsedData.execution.result.length} events`);
        return handleCalendarEventArray(parsedData.execution.result);
      }

      if (Array.isArray(parsedData)) {
        return handleCalendarEventArray(parsedData);
      }
      return formatSingleCalendarEvent(parsedData);
    } catch (e) {
      // If parsing fails, return as-is
      console.log(`[McpToolBox] Error parsing Calendar string:`, e);
      return data;
    }
  }

  // Handle when data is directly an event object (not an array)
  if (data && typeof data === 'object') {
    // Check for nested results from Zapier format
    if (data.results && Array.isArray(data.results)) {
      console.log(`[McpToolBox] Found nested results array in object with ${data.results.length} events`);
      return handleCalendarEventArray(data.results);
    }

    // Check for execution.result format from Zapier
    if (data.execution && data.execution.result && Array.isArray(data.execution.result)) {
      console.log(`[McpToolBox] Found execution.result array in object with ${data.execution.result.length} events`);
      return handleCalendarEventArray(data.execution.result);
    }

    return formatSingleCalendarEvent(data);
  }

  // Fallback if we can't determine the format
  return JSON.stringify(data, null, 2);
}

/**
 * Helper function to process arrays of calendar data
 */
function handleCalendarEventArray(data: any[]): string {
  console.log(`[McpToolBox] Processing calendar data array:`, data);

  // CRITICAL: Sanity check to ensure we have a valid array
  if (!data || !Array.isArray(data)) {
    console.log(`[McpToolBox] Invalid calendar data - not an array:`, data);
    return "Error processing calendar data - invalid format received.";
  }

  // First check if this is the exact format seen in the logs
  if (data.length > 0 &&
    typeof data[0] === 'object' &&
    'kind' in data[0] &&
    data[0].kind === 'calendar#event' &&
    'summary' in data[0]) {

    console.log(`[McpToolBox] Found calendar events in standard Google Calendar API format:`, data.length);

    // This is already a proper array of calendar events
    let header = '';
    if (data.length > 1) {
      header = `Found ${data.length} calendar events:\n\n`;
    } else {
      header = `Found ${data.length} calendar event:\n\n`;
    }

    // Sort events by start date
    const sortedEvents = [...data].sort((a, b) => {
      const aDate = getEventStartTimestamp(a);
      const bDate = getEventStartTimestamp(b);
      return aDate - bDate;
    });

    // Format each event separately
    return header + sortedEvents.map((event, index) =>
      formatSingleCalendarEvent(event, index)
    ).join('\n\n');
  }

  // Check if the data might be inside a wrapper object
  if (data.length === 1 && typeof data[0] === 'object') {
    // Check if there are results inside this object (common Zapier format)
    if (data[0].results && Array.isArray(data[0].results)) {
      console.log(`[McpToolBox] Found nested results array with ${data[0].results.length} events`);
      return handleCalendarEventArray(data[0].results);
    }

    // Check for execution.result format
    if (data[0].execution && data[0].execution.result &&
      Array.isArray(data[0].execution.result)) {
      console.log(`[McpToolBox] Found execution.result array with ${data[0].execution.result.length} events`);
      return handleCalendarEventArray(data[0].execution.result);
    }

    // Check if this is a response wrapper with a single event
    if (Object.keys(data[0]).length > 0 &&
      (data[0].summary || data[0].title || data[0].start || data[0].date)) {
      return formatSingleCalendarEvent(data[0]);
    }
  }

  // Check if it's an empty array or "not found" result
  if (data.length === 0 || (data.length === 1 && data[0]._zap_search_was_found_status === false)) {
    return "No calendar events found matching your search criteria.";
  }

  // Add a summary header if multiple events were found
  let header = '';
  if (data.length > 1) {
    header = `Found ${data.length} calendar events:\n\n`;
  } else {
    header = `Found ${data.length} calendar event:\n\n`;
  }

  // If this is actually a single event spread across multiple array items
  // (which happens with some Zapier MCP integrations)
  const isSingleEventInParts = data.every(item =>
    typeof item === 'object' &&
    Object.keys(item).length < 10 &&
    !item.hasOwnProperty('summary')
  );

  if (isSingleEventInParts) {
    // Combine all properties into a single object
    const combinedEvent = data.reduce((acc, item) => ({ ...acc, ...item }), {});
    return formatSingleCalendarEvent(combinedEvent);
  }

  // Sort events by start date if available
  const sortedEvents = [...data].sort((a, b) => {
    const aDate = getEventStartTimestamp(a);
    const bDate = getEventStartTimestamp(b);
    return aDate - bDate;
  });

  // Format each event separately
  return header + sortedEvents.map((event, index) =>
    formatSingleCalendarEvent(event, index)
  ).join('\n\n');
}

/**
 * Helper to get event timestamp for sorting
 */
function getEventStartTimestamp(event: any): number {
  // Try to extract and parse date from various formats
  try {
    // Check for different date formats
    const dateStr =
      event.start?.dateTime ||
      event.start?.date ||
      event.start__dateTime ||
      event.start__date ||
      event.start_dateTime ||
      event.start_date;

    if (dateStr) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.getTime();
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }

  // Return far future for events without valid dates
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Format a single calendar event with improved styling
 */
function formatSingleCalendarEvent(event: any, index: number = 0): string {
  console.log(`[McpToolBox] Processing single calendar event:`, event);

  // Get event summary/title from various possible locations
  const summary = event.summary || event.title || event.name || 'Untitled Event';

  // Handle different date formats that might come back
  const startDate = extractDate(event, 'start');
  const endDate = extractDate(event, 'end');

  // Format times more intelligently when both start and end are present
  const { formattedStartDate, formattedEndDate } = formatDateRange(startDate, endDate);

  // Handle reminders
  const reminders = extractReminders(event);

  // Extract location
  const location = event.location || '';

  // Extract description
  const description = event.description || '';
  // Truncate description if too long
  const truncatedDescription = description.length > 200
    ? description.substring(0, 200) + '...'
    : description;

  // Extract status
  const status = event.status || '';
  const formattedStatus = formatEventStatus(status);

  // Extract HTML link
  const htmlLink = event.htmlLink || event.link || '';

  // Extract participants/attendees
  const attendees = extractAttendees(event);

  // Duration calculation
  let duration = '';
  if (event.duration_minutes) {
    duration = `${event.duration_minutes} minute${event.duration_minutes !== 1 ? 's' : ''}`;
  } else if (event.duration_hours) {
    duration = `${event.duration_hours} hour${event.duration_hours !== 1 ? 's' : ''}`;
  } else if (event.duration_seconds) {
    const minutes = Math.floor(event.duration_seconds / 60);
    duration = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (startDate && endDate) {
    try {
      // Try to calculate duration from start and end dates
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const durationMs = end.getTime() - start.getTime();
        const minutes = Math.floor(durationMs / (1000 * 60));
        if (minutes < 60) {
          duration = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
          const hours = Math.floor(minutes / 60);
          const remainingMinutes = minutes % 60;
          duration = `${hours} hour${hours !== 1 ? 's' : ''}${remainingMinutes > 0 ? ` ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}` : ''}`;
        }
      }
    } catch (e) {
      // Ignore duration calculation errors
    }
  }

  // Create event emoji based on summary keywords
  const eventEmoji = getEventEmoji(summary, description);
  const isAllDay = event.start?.date && !event.start?.dateTime;

  // Format the event data with visual improvements
  return [
    `${index > 0 ? '\n' : ''}${eventEmoji} ${summary}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    formattedStartDate ? `🕒 When: ${formattedStartDate}${formattedEndDate ? ` to ${formattedEndDate}` : ''}${isAllDay ? ' (All day)' : ''}` : '',
    duration ? `⏱️ Duration: ${duration}` : '',
    location ? `📍 Location: ${location}` : '',
    attendees ? `👥 Attendees: ${attendees}` : '',
    formattedStatus ? `🔔 Status: ${formattedStatus}` : '',
    reminders ? `⏰ Reminders: ${reminders}` : '',
    '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈',
    truncatedDescription ? truncatedDescription : '(No description provided)',
    htmlLink ? `\n🔗 Link: ${htmlLink}` : '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ].filter(Boolean).join('\n');
}

/**
 * Helper function to format date range intelligently
 */
function formatDateRange(startDate: string, endDate: string): { formattedStartDate: string, formattedEndDate: string } {
  if (!startDate) {
    return { formattedStartDate: '', formattedEndDate: endDate || '' };
  }

  try {
    const start = new Date(startDate);
    let formattedStartDate = startDate;
    let formattedEndDate = endDate;

    if (!isNaN(start.getTime())) {
      // Format start date
      formattedStartDate = formatCalendarDateTime(start);

      // Format end date if available
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          // Check if same day
          const sameDay = start.getDate() === end.getDate() &&
            start.getMonth() === end.getMonth() &&
            start.getFullYear() === end.getFullYear();

          if (sameDay) {
            // If same day, just show the end time
            formattedEndDate = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } else {
            // Different days, show full date
            formattedEndDate = formatCalendarDateTime(end);
          }
        }
      }
    }

    return { formattedStartDate, formattedEndDate };
  } catch (e) {
    // If date parsing fails, return originals
    return { formattedStartDate: startDate, formattedEndDate: endDate };
  }
}

/**
 * Format a calendar date-time in a friendly way
 */
function formatCalendarDateTime(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const isTomorrow = date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear();

  if (isToday) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else if (isTomorrow) {
    return `Tomorrow at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    // Include weekday for dates within the next week
    const inOneWeek = new Date(now);
    inOneWeek.setDate(inOneWeek.getDate() + 7);

    if (date < inOneWeek) {
      return date.toLocaleDateString([], {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else {
      return date.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }
}

/**
 * Format event status in a user-friendly way
 */
function formatEventStatus(status: string): string {
  if (!status) return '';

  status = status.toLowerCase();

  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'tentative':
      return 'Tentative';
    case 'cancelled':
    case 'canceled':
      return 'Cancelled';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/**
 * Extract attendees list from event
 */
function extractAttendees(event: any): string {
  if (!event.attendees && !event.organizer) return '';

  const attendeesList: string[] = [];

  // Add organizer if available
  if (event.organizer) {
    let organizerName = '';
    if (typeof event.organizer === 'string') {
      organizerName = event.organizer;
    } else if (event.organizer.email) {
      organizerName = event.organizer.displayName || event.organizer.email;
    }

    if (organizerName) {
      attendeesList.push(`${organizerName} (Organizer)`);
    }
  }

  // Process attendees array
  if (Array.isArray(event.attendees)) {
    // Get non-organizer attendees
    const otherAttendees = event.attendees
      .filter((attendee: any) => {
        if (!attendee) return false;
        if (attendee.organizer) return false;
        return true;
      })
      .map((attendee: any) => {
        let name = '';
        if (typeof attendee === 'string') {
          name = attendee;
        } else if (attendee.email) {
          name = attendee.displayName || attendee.email;

          // Add response status if available
          if (attendee.responseStatus) {
            const status = attendee.responseStatus.toLowerCase();
            if (status === 'accepted') name += ' ✓';
            else if (status === 'declined') name += ' ✗';
            else if (status === 'tentative') name += ' ?';
          }
        }
        return name;
      })
      .filter(Boolean);

    // Add to list
    if (otherAttendees.length > 0) {
      if (otherAttendees.length <= 5) {
        // Show all attendees if 5 or fewer
        attendeesList.push(...otherAttendees);
      } else {
        // Show first 5 and count if more than 5
        attendeesList.push(
          ...otherAttendees.slice(0, 5),
          `+ ${otherAttendees.length - 5} more`
        );
      }
    }
  }

  return attendeesList.join(', ');
}

/**
 * Choose an appropriate emoji for the event based on its title/description
 */
function getEventEmoji(title: string, description: string): string {
  // Convert to lowercase for easier matching
  const lowerTitle = (title || '').toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  const combined = lowerTitle + ' ' + lowerDesc;

  // Match on keywords to return appropriate emoji
  if (combined.includes('meet') || combined.includes('zoom') || combined.includes('call') || combined.includes('chat') || combined.includes('talk')) {
    return '📞';
  }
  if (combined.includes('lunch') || combined.includes('dinner') || combined.includes('breakfast') || combined.includes('food') || combined.includes('eat')) {
    return '🍽️';
  }
  if (combined.includes('birthday') || combined.includes('celebration') || combined.includes('party')) {
    return '🎉';
  }
  if (combined.includes('flight') || combined.includes('travel') || combined.includes('trip')) {
    return '✈️';
  }
  if (combined.includes('doctor') || combined.includes('medical') || combined.includes('health') || combined.includes('appointment')) {
    return '🩺';
  }
  if (combined.includes('workout') || combined.includes('exercise') || combined.includes('gym') || combined.includes('fitness')) {
    return '💪';
  }
  if (combined.includes('movie') || combined.includes('watch') || combined.includes('film') || combined.includes('tv')) {
    return '🎬';
  }
  if (combined.includes('coffee') || combined.includes('tea')) {
    return '☕';
  }
  if (combined.includes('deadline') || combined.includes('due') || combined.includes('submit')) {
    return '⏰';
  }
  if (combined.includes('cancel') || combined.includes('subscription') || combined.includes('cancel') || combined.includes('reminder')) {
    return '🔔';
  }

  // Default emoji
  return '📅';
}

/**
 * Helper to extract dates from various formats in calendar events
 */
function extractDate(event: any, type: 'start' | 'end'): string {
  console.log(`[McpToolBox] Extracting ${type} date from:`, event);
  if (!event) return '';

  try {
    // First, handle the case where we have a direct date property
    const directDate = event[type];
    if (directDate && typeof directDate === 'string') {
      return directDate;
    }

    // Some Zapier formats have a direct dateTime field
    const directDateTime = event[`${type}DateTime`];
    if (directDateTime && typeof directDateTime === 'string') {
      return directDateTime;
    }

    // Then check for the pretty date formats
    const prettyDate = event[`${type}_date_pretty`] || event[`${type}__date_pretty`] || event[`${type}.date_pretty`];
    const prettyDateTime = event[`${type}_dateTime_pretty`] || event[`${type}__dateTime_pretty`] || event[`${type}.dateTime_pretty`];

    if (prettyDateTime) {
      // Sometimes we have a pretty date/time that we can use directly
      return prettyDateTime;
    } else if (prettyDate) {
      // Sometimes we just have the date without time
      return prettyDate;
    }

    // Now check nested objects (common format)
    const nestedObj = event[type];
    if (nestedObj && typeof nestedObj === 'object') {
      // Check all possible date properties in the nested object
      // Special case for date_pretty which is user-friendly format
      if (nestedObj.date_pretty) {
        return nestedObj.date_pretty;
      }
      if (nestedObj.dateTime_pretty) {
        return nestedObj.dateTime_pretty;
      }
      if (nestedObj.dateTime) {
        return nestedObj.dateTime;
      }
      if (nestedObj.date) {
        return nestedObj.date;
      }
    }

    // Check for underscore format common in some API responses
    const underscoreDate = event[`${type}__date`] || event[`${type}_date`];
    if (underscoreDate) {
      return underscoreDate;
    }

    const underscoreDateTime = event[`${type}__dateTime`] || event[`${type}_dateTime`];
    if (underscoreDateTime) {
      return underscoreDateTime;
    }

    // Special handling for specific Zapier format (date and time are separate)
    // Example from the logs: {"date":"2025-05-21", "time":"", ...}
    if (type === 'start' && event.start?.date) {
      const timeComponent = event.start.time ? ` ${event.start.time}` : '';
      return `${event.start.date}${timeComponent}`;
    }
    if (type === 'end' && event.end?.date) {
      const timeComponent = event.end.time ? ` ${event.end.time}` : '';
      return `${event.end.date}${timeComponent}`;
    }

    // Return empty string if no date found
    return '';
  } catch (e) {
    console.error(`[McpToolBox] Error extracting ${type} date:`, e);
    return '';
  }
}

/**
 * Helper function to extract reminders from an event
 */
function extractReminders(event: any): string {
  // Check for reminders in various formats
  if (event.reminders?.overrides && Array.isArray(event.reminders.overrides)) {
    return event.reminders.overrides
      .map((r: any) => `${r.method}: ${r.minutes} minutes before`)
      .join(', ');
  }

  if (event.reminders__overrides && Array.isArray(event.reminders__overrides)) {
    return event.reminders__overrides
      .map((r: any) => `${r.method}: ${r.minutes} minutes before`)
      .join(', ');
  }

  if (event.reminderOverrides && Array.isArray(event.reminderOverrides)) {
    return event.reminderOverrides
      .map((r: any) => `${r.method}: ${r.minutes} minutes before`)
      .join(', ');
  }

  return '';
}

/**
 * Handler for GitHub-related tools
 */
function formatGithubData(data: any, toolName: string): string {
  if (!data) return "No GitHub data returned";

  // Different formatting based on GitHub API endpoints
  if (toolName.includes('search_repositories')) {
    return formatGithubRepoSearch(data);
  } else if (toolName.includes('list_commits')) {
    return formatGithubCommits(data);
  } else if (toolName.includes('get_file_contents')) {
    return formatGithubFileContents(data);
  }

  // Default GitHub data formatting
  return JSON.stringify(data, null, 2);
}

/**
 * Format GitHub repository search results
 */
function formatGithubRepoSearch(data: any): string {
  if (!data.items || !Array.isArray(data.items)) {
    return JSON.stringify(data, null, 2);
  }

  const header = `Found ${data.total_count || data.items.length} repositories:`;
  const repos = data.items.map((repo: any) => {
    return [
      `📂 ${repo.full_name || repo.name}`,
      `Description: ${repo.description || 'No description'}`,
      `Stars: ${repo.stargazers_count || 0} | Forks: ${repo.forks_count || 0}`,
      `Language: ${repo.language || 'Not specified'}`,
      `URL: ${repo.html_url || ''}`,
      '----------------'
    ].join('\n');
  }).join('\n\n');

  return `${header}\n\n${repos}`;
}

/**
 * Format GitHub commits
 */
function formatGithubCommits(data: any): string {
  if (!Array.isArray(data)) {
    return JSON.stringify(data, null, 2);
  }

  const header = `Commits: ${data.length}`;
  const commits = data.map((commit: any) => {
    const sha = commit.sha?.substring(0, 7) || 'unknown';
    const author = commit.commit?.author?.name || commit.author?.login || 'unknown';
    const date = commit.commit?.author?.date || 'unknown date';
    const message = commit.commit?.message || 'No message';

    return [
      `Commit: ${sha}`,
      `Author: ${author}`,
      `Date: ${date}`,
      `Message: ${message}`,
      '----------------'
    ].join('\n');
  }).join('\n\n');

  return `${header}\n\n${commits}`;
}

/**
 * Format GitHub file contents
 */
function formatGithubFileContents(data: any): string {
  if (data.type === 'file') {
    const content = data.content || '';
    // GitHub API returns base64-encoded content
    if (data.encoding === 'base64') {
      try {
        // We show a preview but not the entire file if it's large
        const decoded = atob(content.replace(/\n/g, ''));
        const preview = decoded.length > 1000
          ? decoded.substring(0, 1000) + '...\n[Content truncated, full content available in response]'
          : decoded;

        return [
          `File: ${data.name || 'unnamed'}`,
          `Size: ${data.size || 'unknown'} bytes`,
          `Path: ${data.path || ''}`,
          `SHA: ${data.sha || ''}`,
          '----------------',
          preview
        ].join('\n');
      } catch (e) {
        return `File: ${data.name || 'unnamed'}\nUnable to decode content: ${e}`;
      }
    }
    return `File: ${data.name || 'unnamed'}\n${content}`;
  } else if (data.type === 'dir') {
    const header = `Directory: ${data.path || ''}`;
    const files = (data.entries || []).map((entry: any) => {
      return `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`;
    }).join('\n');

    return `${header}\n----------------\n${files}`;
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Renders JSON data in a pretty format based on the type of MCP tool
 */

function renderJson(data: any, toolName: string): string {
  try {
    // Log the data we're getting to help debug
    console.log(`[McpToolBox] Rendering data for ${toolName}:`, data);
    console.log(`[McpToolBox] Data type: ${typeof data}`);

    // If the data is null or undefined, provide a clear message
    if (data === null || data === undefined) {
      return "No data returned from the tool.";
    }

    // CRITICAL FIX: Check if we're processing a Google Calendar API response with complex structure
    if (toolName.includes('calendar') || toolName.includes('google_calendar')) {
      console.log(`[McpToolBox] Processing calendar data with special handling:`);

      // Handle direct string format
      if (typeof data === 'string') {
        console.log(`[McpToolBox] Calendar data is string (${data.length} chars), checking for JSON`);

        // Try to parse as JSON if it looks like JSON
        if ((data.startsWith('{') && data.endsWith('}')) || (data.startsWith('[') && data.endsWith(']'))) {
          try {
            const parsed = JSON.parse(data);
            console.log(`[McpToolBox] Successfully parsed calendar string to JSON:`, parsed);

            // Check for Zapier's nested structure (data.results[])
            if (parsed.results && Array.isArray(parsed.results)) {
              console.log(`[McpToolBox] Found Zapier results array with ${parsed.results.length} events`);

              // Pass to our formatter
              return formatCalendarData(parsed);
            }

            // Check for plain array of events
            if (Array.isArray(parsed)) {
              console.log(`[McpToolBox] Found plain array of events: ${parsed.length}`);
              return formatCalendarData(parsed);
            }
          } catch (e) {
            console.error(`[McpToolBox] Error parsing calendar JSON:`, e);
          }
        }
      }

      // Handle content structure with array of parts
      if (data && typeof data === 'object' && data.content && Array.isArray(data.content)) {
        const textPart = data.content.find((part: any) => part.type === 'text');
        if (textPart && textPart.text) {
          console.log(`[McpToolBox] Found text part in calendar data: ${textPart.text.substring(0, 100)}...`);

          // Try to parse as JSON if it looks like JSON
          if ((textPart.text.startsWith('{') && textPart.text.endsWith('}')) ||
            (textPart.text.startsWith('[') && textPart.text.endsWith(']'))) {
            try {
              const parsed = JSON.parse(textPart.text);
              console.log(`[McpToolBox] Parsed calendar JSON from text part:`, parsed);

              // SPECIAL FIX for Zapier format
              if (parsed.results && Array.isArray(parsed.results)) {
                console.log(`[McpToolBox] Found results array in parsed JSON: ${parsed.results.length} events`);

                // Empty results case
                if (parsed.results.length === 0) {
                  return "No calendar events found matching your search criteria.";
                }

                return handleCalendarEventArray(parsed.results);
              }
            } catch (e) {
              console.error(`[McpToolBox] Error parsing inner calendar JSON:`, e);
            }
          }
        }
      }
    }

    // Check for plain string first (common for explanation text)
    if (typeof data === 'string' &&
      !data.startsWith('{') &&
      !data.startsWith('[') &&
      !data.includes('raw__payload')) {
      // This is likely just explanation text, return as-is
      return data;
    }

    // 🎯 CRITICAL FIX: Use universal formatter for ALL MCP tools
    console.log(`[McpToolBox] Using universal formatter for ${toolName}`);
    try {
      const universalResult = formatToolResultUniversally(data, toolName);
      if (universalResult.hasRichContent) {
        console.log(`[McpToolBox] Universal formatter detected rich content for ${toolName}`);
        return universalResult.markdown;
      } else {
        console.log(`[McpToolBox] Universal formatter returned plain content for ${toolName}`);
        return universalResult.markdown;
      }
    } catch (e) {
      console.error(`[McpToolBox] Error with universal formatter for ${toolName}:`, e);
      // Fallback to original JSON rendering if universal formatter fails
    }

    // Check for nested content structure (common in MCP tools)
    if (data && data.content && Array.isArray(data.content)) {
      console.log(`[McpToolBox] Found nested content structure with ${data.content.length} items`);
      const textPart = data.content.find((part: any) => part.type === 'text');
      if (textPart && textPart.text) {
        try {
          // Check if the text looks like JSON
          if ((textPart.text.startsWith('[') && textPart.text.endsWith(']')) ||
            (textPart.text.startsWith('{') && textPart.text.endsWith('}'))) {
            const parsed = JSON.parse(textPart.text);
            console.log(`[McpToolBox] Successfully parsed nested JSON content:`, parsed);

            // Special case for Zapier format with results array
            if (parsed.results && Array.isArray(parsed.results)) {
              console.log(`[McpToolBox] Found results array in Zapier response:`, parsed.results);

              if (toolName.includes('calendar')) {
                return formatCalendarData(parsed);
              }
            }

            // If the parsed result matches a specific data format, use the appropriate formatter
            if (toolName.includes('gmail') && Array.isArray(parsed)) {
              return formatGmailEmailArray(parsed);
            } else if (toolName.includes('calendar')) {
              return formatCalendarData(parsed);
            } else {
              // For other tool types, just pretty-print the JSON
              return JSON.stringify(parsed, null, 2);
            }
          }
          return textPart.text;
        } catch (e) {
          console.log(`[McpToolBox] Error parsing content text:`, e);
          return textPart.text; // Return as-is if parsing fails
        }
      }
    }

    // If the data is a string that looks like JSON, try to parse and pretty-print it
    if (typeof data === 'string') {
      // Check if it starts with characters that look like stringified JSON
      if ((data.startsWith('[') && data.endsWith(']')) ||
        (data.startsWith('{') && data.endsWith('}'))) {
        try {
          const parsed = JSON.parse(data);
          console.log(`[McpToolBox] Successfully parsed string JSON data`);

          // Try to intelligently determine data type from structure
          if (Array.isArray(parsed)) {
            // Check for Gmail-like structures
            if (parsed.length > 0 &&
              (parsed[0].raw__payload__headers ||
                parsed[0].headers ||
                parsed[0].subject ||
                parsed[0].from)) {
              return formatGmailEmailArray(parsed);
            }

            // Check for Calendar-like structures
            if (parsed.length > 0 &&
              (parsed[0].summary ||
                parsed[0].start ||
                parsed[0].start__date ||
                parsed[0].start__dateTime)) {
              return formatCalendarData(parsed);
            }
          } else if (parsed && typeof parsed === 'object') {
            // Check for single email
            if (parsed.raw__payload__headers || parsed.headers || parsed.subject || parsed.from) {
              return formatGmailData(parsed);
            }

            // Check for single calendar event
            if (parsed.summary || parsed.start || parsed.start__date || parsed.start__dateTime) {
              return formatCalendarData(parsed);
            }
          }

          // If no specific format detected, pretty-print the JSON
          return JSON.stringify(parsed, null, 2);
        } catch (e) {
          console.log(`[McpToolBox] Couldn't parse data as JSON, returning as string:`, e);
          // Not valid JSON, return as is
          return data;
        }
      }
      // Not JSON-like, return as is
      return data;
    }

    // Handle array data intelligently
    if (Array.isArray(data)) {
      console.log(`[McpToolBox] Array data detected with ${data.length} items`);

      // Check for Gmail-like structures
      if (data.length > 0 &&
        (data[0].raw__payload__headers ||
          data[0].headers ||
          data[0].subject ||
          data[0].from)) {
        return formatGmailEmailArray(data);
      }

      // Check for Calendar-like structures
      if (data.length > 0 &&
        (data[0].summary ||
          data[0].start ||
          data[0].start__date ||
          data[0].start__dateTime)) {
        return formatCalendarData(data);
      }

      // If it's an array of simple types, format it nicely
      if (data.length > 0 && data.every(item => typeof item !== 'object' || item === null)) {
        return data.join('\n');
      }

      // If it's an array of objects, try to format them nicely
      if (data.length > 0 && data.every(item => typeof item === 'object' && item !== null)) {
        // Check if they have a common "title" property
        const titleProps = ['name', 'title', 'subject', 'summary', 'id'];
        const commonTitleProp = titleProps.find(prop =>
          data.some(item => item[prop] !== undefined)
        );

        if (commonTitleProp) {
          return data.map(item => {
            const title = item[commonTitleProp] || '[No title]';
            const details = Object.entries(item)
              .filter(([key, _]) => key !== commonTitleProp)
              .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
              .join('\n');

            return `${title}\n----------------\n${details}`;
          }).join('\n\n');
        }
      }

      // Default: pretty-print the JSON
      return JSON.stringify(data, null, 2);
    }

    // Handle single object intelligently
    if (data && typeof data === 'object') {
      console.log(`[McpToolBox] Object data detected`);

      // Check for single email
      if (data.raw__payload__headers || data.headers || data.subject || data.from) {
        return formatGmailData(data);
      }

      // Check for single calendar event
      if (data.summary || data.start || data.start__date || data.start__dateTime) {
        return formatCalendarData(data);
      }

      // Check for common named properties that would make good titles
      const hasTitleProperties = ['name', 'title', 'subject', 'summary', 'id'].some(prop =>
        data[prop] !== undefined
      );

      if (hasTitleProperties) {
        const title = data.name || data.title || data.subject || data.summary || data.id;
        const details = Object.entries(data)
          .filter(([key, _]) => !['name', 'title', 'subject', 'summary'].includes(key))
          .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
          .join('\n');

        return `${title}\n----------------\n${details}`;
      }
    }

    // For objects or any other type, convert to pretty-printed JSON
    return JSON.stringify(data, null, 2);
  } catch (e) {
    console.error(`[McpToolBox] Error rendering JSON:`, e);
    // If anything fails, return the raw data as a string
    return String(data);
  }
}

/**
 * McpToolBox component displays MCP tool calls and their results
 * in a format similar to Cursor's MCP tool display
 */
export function McpToolBox({ toolCall, toolResult, onApprove, onCancel, requireExplicitApproval = true, initialExplanationText, persistentState, isApproved = false, isCancelled = false, sessionId }: McpToolBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();
  // 🎯 CRITICAL FIX: Remove local isApproved state - use prop instead for immediate updates 
  // State to track if the tool is currently running *after* approval
  const [isRunning, setIsRunning] = useState(persistentState?.status === 'running');
  // New state to track if results should be displayed - auto-enable if toolResult exists OR persistent state shows completion
  const [shouldDisplayResult, setShouldDisplayResult] = useState(!!toolResult || (persistentState && ['completed', 'error'].includes(persistentState.status)));

  const [userVisibleResult, setUserVisibleResult] = useState<ToolResultPart | null>(toolResult || null);
  const [isStabilized, setIsStabilized] = useState(false);
  const [isContentReady, setIsContentReady] = useState(false);
  const [explanationText, setExplanationText] = useState<string | null>(initialExplanationText || null);
  const [hasExplanation, setHasExplanation] = useState(!!initialExplanationText);
  const [isHovering, setIsHovering] = useState(false);
  const isDarkMode = theme === 'dark';
  const { t } = useLanguage();

  // 🎯 NEW: State for preserving original parameters and computed parameters
  const [originalParameters, setOriginalParameters] = useState<any>(null);
  const [parametersToDisplay, setParametersToDisplay] = useState<any>(null);
  const [parameterSourceInfo, setParameterSourceInfo] = useState<string>('');

  // 🎯 CRITICAL FIX: Force re-render when persistent state changes
  const [forceRenderKey, setForceRenderKey] = useState(0);

  // 🎯 NEW: Preserve original parameters immediately on component mount/update
  React.useEffect(() => {
    if (toolCall.args && Object.keys(toolCall.args).length > 0) {
      console.log(`[McpToolBox] 📋 PRESERVING original parameters for ${toolCall.toolName}:`, toolCall.args);
      setOriginalParameters(toolCall.args);
    }
  }, [toolCall.toolCallId, toolCall.args, toolCall.toolName]);

  // 🎯 ENHANCED: Smart parameter display logic with comprehensive debugging
  React.useEffect(() => {
    console.log(`[McpToolBox] 🔍 PARAMETER ANALYSIS for ${toolCall.toolName}`);
    console.log(`[McpToolBox] 📊 Data Sources Available:`);
    console.log(`[McpToolBox]   - toolCall.args:`, toolCall.args);
    console.log(`[McpToolBox]   - originalParameters:`, originalParameters);
    console.log(`[McpToolBox]   - persistentState?.tool_params:`, persistentState?.tool_params);
    console.log(`[McpToolBox]   - persistentState?.status:`, persistentState?.status);

    // Extract parameters from all available sources
    const toolCallParams = toolCall.args || {};
    const originalParams = originalParameters || {};
    const persistentParams = persistentState?.tool_params || {};

    console.log(`[McpToolBox] ========================================`);
    console.log(`[McpToolBox] PARAMETER ANALYSIS FOR TOOL: ${toolCall.toolName}`);
    console.log(`[McpToolBox] Tool Call ID: ${toolCall.toolCallId}`);
    console.log(`[McpToolBox] 📝 Parameter Counts:`);
    console.log(`[McpToolBox]   - toolCall.args keys: ${Object.keys(toolCallParams).length}`);
    console.log(`[McpToolBox]   - originalParameters keys: ${Object.keys(originalParams).length}`);
    console.log(`[McpToolBox]   - persistentState.tool_params keys: ${Object.keys(persistentParams).length}`);

    console.log(`[McpToolBox] 📝 Parameter Details:`);
    console.log(`[McpToolBox]   - toolCall.args:`, JSON.stringify(toolCallParams, null, 2));
    console.log(`[McpToolBox]   - originalParameters:`, JSON.stringify(originalParams, null, 2));
    console.log(`[McpToolBox]   - persistentState.tool_params:`, JSON.stringify(persistentParams, null, 2));

    if (toolCall.toolName.includes('gmail') && toolCall.toolName.includes('find_email')) {
      console.log(`[McpToolBox] 🔍 GMAIL FIND_EMAIL SPECIFIC CHECKS:`);
      console.log(`[McpToolBox]   - toolCall.args has instructions:`, !!(toolCallParams as any).instructions);
      console.log(`[McpToolBox]   - toolCall.args has query:`, !!(toolCallParams as any).query);
      console.log(`[McpToolBox]   - originalParameters has instructions:`, !!(originalParams as any).instructions);
      console.log(`[McpToolBox]   - originalParameters has query:`, !!(originalParams as any).query);
      console.log(`[McpToolBox]   - persistentState has instructions:`, !!(persistentParams as any).instructions);
      console.log(`[McpToolBox]   - persistentState has query:`, !!(persistentParams as any).query);
    }

    let finalParameters = {};
    let sourceDescription = '';

    // 🎯 PRIORITY 1: Use persistent state parameters if available (contains transformed params)
    if (Object.keys(persistentParams).length > 0) {
      finalParameters = { ...persistentParams };
      sourceDescription = 'persistent state (transformed)';
      console.log(`[McpToolBox] ✅ Using persistent state transformed parameters (${Object.keys(persistentParams).length} keys)`);
    }
    // 🎯 PRIORITY 2: Use original parameters if persistent not available
    else if (Object.keys(originalParams).length > 0) {
      finalParameters = { ...originalParams };
      sourceDescription = 'preserved original parameters';
      console.log(`[McpToolBox] ✅ Using original parameters (${Object.keys(originalParams).length} keys)`);
    }
    // 🎯 PRIORITY 3: Use toolCall.args as fallback
    else if (Object.keys(toolCallParams).length > 0) {
      finalParameters = { ...toolCallParams };
      sourceDescription = 'toolCall.args fallback';
      console.log(`[McpToolBox] ⚠️ Using toolCall.args as fallback (${Object.keys(toolCallParams).length} keys)`);
    }

    console.log(`[McpToolBox] 🎯 FINAL PARAMETERS (source: ${sourceDescription}):`, finalParameters);
    console.log(`[McpToolBox] 📊 Final parameter count: ${Object.keys(finalParameters).length}`);

    if (toolCall.toolName.includes('gmail') && toolCall.toolName.includes('find_email')) {
      console.log(`[McpToolBox] 🔍 FINAL GMAIL FIND_EMAIL PARAMETERS:`);
      console.log(`[McpToolBox]   - Final has instructions:`, !!(finalParameters as any).instructions);
      console.log(`[McpToolBox]   - Final has query:`, !!(finalParameters as any).query);
      console.log(`[McpToolBox]   - Final parameter keys:`, Object.keys(finalParameters));
    }

    console.log(`[McpToolBox] ========================================`);

    // 🖼️ GOOGLE DRIVE PARAMETER ENHANCEMENT: Add file URLs for Google Drive tools
    const enhanceGoogleDriveParameters = async () => {
      let enhancedParameters: Record<string, unknown> = { ...finalParameters };

      if ((toolCall.toolName.includes('google_drive') || toolCall.toolName.includes('drive_upload') ||
        toolCall.toolName.includes('uploadFile') || toolCall.toolName.includes('upload_file')) && sessionId) {

        console.log(`[McpToolBox] 🔍 ENHANCING GOOGLE DRIVE PARAMETERS for ${toolCall.toolName}`);
        console.log(`[McpToolBox] Session ID:`, sessionId);
        console.log(`[McpToolBox] Original parameters:`, finalParameters);

        try {
          // Dynamic import to access Image Context Manager
          const { getMostRecentImageUrl, getDownloadableUrls } = await import('@/lib/mcp/image-context-manager');

          // Try to get the most recent image URL for the session
          let imageUrl = getMostRecentImageUrl(sessionId);

          // Fallback: try to get any downloadable URL
          if (!imageUrl) {
            const downloadableUrls = getDownloadableUrls(sessionId);
            if (downloadableUrls && downloadableUrls.length > 0) {
              imageUrl = downloadableUrls[0];
              console.log(`[McpToolBox] ✅ Found image URL from downloadable URLs:`, imageUrl);
            }
          } else {
            console.log(`[McpToolBox] ✅ Found image URL from most recent:`, imageUrl);
          }

          // Apply the image URL to parameters if found
          if (imageUrl) {
            enhancedParameters = {
              ...enhancedParameters,
              file: imageUrl,
              file_url: imageUrl,
              filename: enhancedParameters.filename || 'uploaded-image.png'
            };

            console.log(`[McpToolBox] ✅ Enhanced Google Drive parameters with file URL:`, enhancedParameters);
            setParameterSourceInfo(sourceDescription + ' (enhanced with file URL)');
          } else {
            console.log(`[McpToolBox] ❌ No image URL found for Google Drive tool`);
            setParameterSourceInfo(sourceDescription + ' (no file URL found)');
          }
        } catch (error) {
          console.error(`[McpToolBox] ❌ Error enhancing Google Drive parameters:`, error);
          setParameterSourceInfo(sourceDescription + ' (file URL enhancement failed)');
        }
      } else {
        setParameterSourceInfo(sourceDescription);
      }

      setParametersToDisplay(enhancedParameters);
    };

    // Execute the enhancement
    enhanceGoogleDriveParameters();

    // 🎯 CRITICAL FIX: Force re-render when status changes
    setForceRenderKey(prev => prev + 1);

    // Log approval state for debugging
    if (persistentState?.status === 'approved' || persistentState?.status === 'running' || persistentState?.status === 'completed') {
      console.log(`[McpToolBox] Tool is approved based on persistent state: ${persistentState.status}`);
    }
  }, [toolCall.toolCallId, toolCall.toolName, toolCall.args, originalParameters, persistentState?.tool_params, persistentState?.status, sessionId]);

  // Debug log when toolResult changes
  React.useEffect(() => {
    if (toolResult) {
      console.log(`[McpToolBox DEBUG] Received toolResult for ${toolCall.toolName}, approved=${isApproved}, shouldDisplay=${shouldDisplayResult}, requireExplicitApproval=${requireExplicitApproval}`);
      console.log(`[McpToolBox DEBUG] Result:`, toolResult);
    }
  }, [toolResult, toolCall.toolName, isApproved, shouldDisplayResult, requireExplicitApproval]);

  // 🎯 CRITICAL FIX: Memoize status calculation to prevent unnecessary re-renders
  const status = React.useMemo(() => {
    // Debug log for status calculations
    console.log(`[McpToolBox STATUS CHECK] toolCall=${toolCall.toolName}, persistentState=${persistentState?.status}, isApproved=${isApproved}, isCancelled=${isCancelled}, requireExplicitApproval=${requireExplicitApproval}, hasResult=${!!toolResult}, forceRenderKey=${forceRenderKey}`);

    // PRIORITY 1: Check if we already have results (tool was executed)
    if (toolResult) {
      if (toolResult.isError) {
        console.log(`[McpToolBox STATUS] Showing 'error' status because tool result has error`);
        return 'error';
      }
      // Tool completed successfully
      console.log(`[McpToolBox STATUS] Showing 'completed' status because tool has successful result`);
      return 'completed';
    }

    // PRIORITY 2: 🎯 CRITICAL FIX - Check isCancelled prop IMMEDIATELY for instant UI updates
    if (isCancelled && !toolResult) {
      console.log(`[McpToolBox STATUS] 🎯 IMMEDIATE: Showing 'cancelled' status because isCancelled prop is true`);
      return 'cancelled';
    }

    // PRIORITY 3: 🎯 CRITICAL FIX - Check isApproved prop IMMEDIATELY for instant UI updates
    if (isApproved && !toolResult) {
      console.log(`[McpToolBox STATUS] 🎯 IMMEDIATE: Showing 'running' status because isApproved prop is true`);
      return 'running';
    }

    // PRIORITY 4: Check persistent state for backend status
    if (persistentState) {
      // 🎯 FIX: Map 'pending' status to 'waiting' for UI display
      if (persistentState.status === 'pending') {
        console.log(`[McpToolBox STATUS] Mapping 'pending' to 'waiting' for approval UI`);
        return 'waiting';
      }
      // 🎯 CRITICAL FIX: Map 'approved' status to 'running' for UI display
      if (persistentState.status === 'approved') {
        console.log(`[McpToolBox STATUS] Mapping 'approved' to 'running' for UI display`);
        return 'running';
      }
      // 🎯 CRITICAL FIX: Handle cancelled status from persistent state
      if (persistentState.status === 'cancelled') {
        console.log(`[McpToolBox STATUS] Mapping 'cancelled' from persistent state`);
        return 'cancelled';
      }
      console.log(`[McpToolBox STATUS] Using persistent state: ${persistentState.status}`);
      return persistentState.status;
    }

    // PRIORITY 5: No result yet - check approval requirements
    if (requireExplicitApproval && !isApproved && !isCancelled) {
      console.log(`[McpToolBox STATUS] Showing 'waiting' status because requireExplicitApproval=${requireExplicitApproval} and isApproved=${isApproved} and isCancelled=${isCancelled}`);
      return 'waiting';
    }

    // PRIORITY 6: No approval required but no result yet = running
    if (!requireExplicitApproval) {
      console.log(`[McpToolBox STATUS] Showing 'running' status because no approval required`);
      return 'running';
    }

    // Default fallback for safety
    console.log(`[McpToolBox STATUS] Showing fallback 'waiting' status`);
    return 'waiting';
  }, [persistentState, isApproved, isCancelled, requireExplicitApproval, toolResult, forceRenderKey, toolCall.toolName]);

  // 🎯 CRITICAL DEBUG: Log the final status that will be used for rendering
  console.log(`[McpToolBox STATUS FINAL] Final status for ${toolCall.toolName}: '${status}' (persistentState=${persistentState?.status}, isApproved=${isApproved}, isCancelled=${isCancelled})`);

  // Force layout stabilization after initial render
  React.useEffect(() => {
    // Small delay to ensure DOM is ready
    const stabilizeTimer = setTimeout(() => {
      setIsStabilized(true);
    }, 50);

    // Slightly longer delay to reveal content after stabilization
    const contentTimer = setTimeout(() => {
      setIsContentReady(true);
    }, 100);

    return () => {
      clearTimeout(stabilizeTimer);
      clearTimeout(contentTimer);
    };
  }, []);

  // 🎯 CRITICAL FIX: Force component update when persistent state changes
  React.useEffect(() => {
    if (persistentState?.status) {
      console.log(`[McpToolBox] 🔄 Persistent state changed to: ${persistentState.status}, forcing component update`);

      // Force re-render by updating force render key
      setForceRenderKey(prev => {
        const newKey = prev + 1;
        console.log(`[McpToolBox] 🔄 Force rendering with key: ${newKey}`);
        return newKey;
      });

      // Also update running state based on persistent state
      if (persistentState.status === 'running') {
        setIsRunning(true);
      } else if (persistentState.status === 'completed' || persistentState.status === 'error') {
        setIsRunning(false);
        setShouldDisplayResult(true);
      }
    }
  }, [persistentState?.status]);

  // Special effect for initialExplanationText
  React.useEffect(() => {
    if (initialExplanationText) {
      console.log('[McpToolBox] Got initialExplanationText prop:', initialExplanationText.substring(0, 100));
      setExplanationText(initialExplanationText);
      setHasExplanation(true);
    }
  }, [initialExplanationText]);

  // Update the useEffect for toolResult processing
  React.useEffect(() => {
    // Debug the rendering of results
    if (toolResult) {
      console.log(`[McpToolBox] Processing toolResult for ${toolCall.toolName}, approved=${isApproved}, shouldDisplay=${shouldDisplayResult}, requireExplicitApproval=${requireExplicitApproval}`);
      console.log(`[McpToolBox] Result:`, toolResult);

      // If we have a result and we don't require approval (or it's been approved)
      // we should show the result regardless of shouldDisplayResult flag
      const canDisplayResult = toolResult &&
        ((!requireExplicitApproval) || isApproved);

      console.log(`[McpToolBox] Result display check: canDisplayResult=${canDisplayResult}, toolResult=${!!toolResult}, isApproved=${isApproved}, requireExplicitApproval=${requireExplicitApproval}`);

      if (canDisplayResult) {
        // Special handling for Google Calendar tool responses
        if ((toolCall.toolName.includes('calendar') || toolCall.toolName.includes('google_calendar')) &&
          toolResult.result) {
          console.log('[McpToolBox] Special processing for Google Calendar result:',
            typeof toolResult.result === 'object' ? JSON.stringify(toolResult.result).substring(0, 200) + '...' : toolResult.result);

          try {
            // Try various formats to extract calendar data
            const resultObj = toolResult.result as any;
            let eventFound = false;

            // CASE 1: Nested content structure with text part
            if (resultObj.content && Array.isArray(resultObj.content)) {
              const textPart = resultObj.content.find((part: any) => part.type === 'text');
              if (textPart && textPart.text && typeof textPart.text === 'string') {
                console.log('[McpToolBox] Found text part in calendar result:', textPart.text.substring(0, 200) + '...');

                // Check if this contains JSON data
                if (textPart.text.startsWith('{') || textPart.text.startsWith('[')) {
                  try {
                    const parsed = JSON.parse(textPart.text);
                    console.log('[McpToolBox] Parsed calendar JSON from text part:', JSON.stringify(parsed).substring(0, 200) + '...');

                    // Look for results array from Zapier
                    if (parsed.results && Array.isArray(parsed.results)) {
                      console.log('[McpToolBox] Found results array with', parsed.results.length, 'items');

                      if (parsed.results.length === 0) {
                        // No events found
                        if (!hasExplanation) {
                          setExplanationText("I searched your Google Calendar but didn't find any upcoming events matching your criteria.");
                          setHasExplanation(true);
                        }
                      } else {
                        // Events found!
                        eventFound = true;
                        if (!hasExplanation) {
                          const eventCount = parsed.results.length;
                          const firstEventSummary = parsed.results[0]?.summary || 'upcoming event';
                          setExplanationText(`I found ${eventCount} upcoming event${eventCount > 1 ? 's' : ''} in your Google Calendar${eventCount === 1 ? `, including "${firstEventSummary}"` : ''}.`);
                          setHasExplanation(true);
                        }
                      }
                    } else if (parsed.execution && parsed.execution.result && Array.isArray(parsed.execution.result)) {
                      console.log('[McpToolBox] Found execution.result array with', parsed.execution.result.length, 'items');

                      if (parsed.execution.result.length === 0) {
                        // No events found
                        if (!hasExplanation) {
                          setExplanationText("I searched your Google Calendar but didn't find any upcoming events matching your criteria.");
                          setHasExplanation(true);
                        }
                      } else {
                        // Events found!
                        eventFound = true;
                        if (!hasExplanation) {
                          const eventCount = parsed.execution.result.length;
                          const firstEventSummary = parsed.execution.result[0]?.summary || 'upcoming event';
                          setExplanationText(`I found ${eventCount} upcoming event${eventCount > 1 ? 's' : ''} in your Google Calendar${eventCount === 1 ? `, including "${firstEventSummary}"` : ''}.`);
                          setHasExplanation(true);
                        }
                      }
                    }
                  } catch (e) {
                    console.error('[McpToolBox] Error parsing calendar JSON from text part:', e);
                  }
                }
              }
            }

            // If no events were found and no explanation set, provide a default
            if (!eventFound && !hasExplanation) {
              setExplanationText(`I've retrieved information from your Google Calendar.`);
              setHasExplanation(true);
            }
          } catch (error) {
            console.error('[McpToolBox] Error processing calendar result:', error);
          }
        }

        console.log('[McpToolBox] Setting user visible result:', toolResult);
        setUserVisibleResult(toolResult);
        setShouldDisplayResult(true); // Force this to true once we have a result
        setIsRunning(false); // Stop showing running state once result is available
      }
    }
  }, [toolResult, toolCall.toolName, isApproved, requireExplicitApproval, hasExplanation, shouldDisplayResult]);

  // Update the explanationText extraction logic around line 441
  React.useEffect(() => {
    // Debug the rendering of results
    console.log('[McpToolBox] Extracting explanation from result');

    // Always set an explanation once we have a result, even if basic
    if (!hasExplanation) {
      const defaultExplanation = `I've retrieved information from ${toolCall.toolName.replace(/_/g, ' ')}. Here are the results.`;
      setExplanationText(defaultExplanation);
      setHasExplanation(true);
    }
  }, [toolResult, userVisibleResult, toolCall.toolName, hasExplanation]);

  // Handle approval action
  const handleApprove = () => {
    if (status === 'waiting') {
      console.log('[McpToolBox] User explicitly approved tool:', toolCall.toolCallId);

      // 🎯 CRITICAL FIX: Immediate UI feedback before backend call
      // Note: isApproved is now a prop controlled by ToolInvocation component
      setIsRunning(true); // Indicate that the tool is now running
      setShouldDisplayResult(true); // Allow results to be displayed after approval

      // Force immediate re-render to show "Running" status
      setForceRenderKey(prev => {
        const newKey = prev + 1;
        console.log('[McpToolBox] 🔄 Immediate UI update after approval, renderKey:', newKey);
        return newKey;
      });

      if (onApprove) {
        onApprove(); // Signal the backend to execute the tool (which will update isApproved prop)
      }
    }
  };

  // Handle cancel action
  const handleCancel = () => {
    if (status === 'waiting') {
      console.log('[McpToolBox] User cancelled tool:', toolCall.toolCallId);
      if (onCancel) {
        onCancel(); // Signal the backend to cancel/ignore
      }
    }
  };

  // If content is not ready, render nothing instead of a placeholder
  if (!isContentReady) {
    return null;
  }

  // Get tool name for display
  const displayToolName = toolCall.toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // --- Status Icon and Text ---
  let statusIcon: React.ReactNode;
  let statusText: string;
  let statusColorClass: string;
  let borderColorClass: string;
  let bgColorClass: string; // For icon background

  switch (status) {
    case 'waiting':
      statusIcon = <Clock className="w-4 h-4" />;
      statusText = 'Approval';
      statusColorClass = "text-amber-700 dark:text-amber-300";
      borderColorClass = "border-amber-200 dark:border-amber-700";
      bgColorClass = "bg-amber-100 dark:bg-amber-900/30";
      break;
    case 'running':
      statusIcon = <Loader2 className="w-4 h-4 animate-spin" />;
      statusText = 'Running';
      statusColorClass = "text-blue-700 dark:text-blue-300";
      borderColorClass = "border-blue-200 dark:border-blue-700";
      bgColorClass = "bg-blue-100 dark:bg-blue-900/30";
      break;
    case 'completed':
      statusIcon = <Check className="w-4 h-4" />;
      statusText = 'Done';
      statusColorClass = "text-emerald-700 dark:text-emerald-300";
      borderColorClass = "border-emerald-200 dark:border-emerald-800";
      bgColorClass = "bg-emerald-100 dark:bg-emerald-900/30";
      break;
    case 'cancelled':
      statusIcon = <X className="w-4 h-4" />;
      statusText = 'Cancelled';
      statusColorClass = "text-gray-700 dark:text-gray-300";
      borderColorClass = "border-gray-200 dark:border-gray-700";
      bgColorClass = "bg-gray-100 dark:bg-gray-900/30";
      break;
    case 'error':
      statusIcon = <FileX className="w-4 h-4" />;
      statusText = 'Error';
      statusColorClass = "text-red-700 dark:text-red-300";
      borderColorClass = "border-red-200 dark:border-red-800";
      bgColorClass = "bg-red-100 dark:bg-red-900/30";
      break;
    default:
      statusIcon = <Loader2 className="w-4 h-4 animate-spin" />;
      statusText = 'Processing';
      statusColorClass = "text-gray-600 dark:text-gray-400";
      borderColorClass = "border-gray-200 dark:border-gray-700";
      bgColorClass = "bg-gray-100 dark:bg-gray-900/30";
  }



  return (
    <div className="my-3" key={`mcp-tool-${toolCall.toolCallId}-${forceRenderKey}`}>
      <div
        className={cn(
          "relative rounded-xl border transition-all duration-200",
          "bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm",
          isHovering ? "shadow-lg border-blue-200 dark:border-blue-800" : "shadow-sm border-gray-200 dark:border-gray-800",
          isStabilized ? "opacity-100" : "opacity-95"
        )}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Compact Header */}
        <div className={cn(
          "flex items-center justify-between px-4 py-3 rounded-t-xl",
          "bg-gradient-to-r from-gray-50/50 to-white/50 dark:from-gray-800/50 dark:to-gray-900/50"
        )}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={cn(
              "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
              bgColorClass,
              statusColorClass
            )}>
              {statusIcon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">
                  {displayToolName}
                </span>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium",
                  statusColorClass,
                  bgColorClass
                )}>
                  {statusText}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "p-1.5 rounded-lg transition-all shrink-0",
              "hover:bg-gray-100 dark:hover:bg-gray-800",
              "focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            )}
            aria-label={isOpen ? "Hide details" : "Show details"}
          >
            <ChevronsUpDown className={cn(
              "h-4 w-4 text-gray-400 transition-transform",
              isOpen && "rotate-180"
            )} />
          </button>
        </div>

        {/* Executing state banner - show when running */}
        {status === 'running' && (
          <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-800 bg-gradient-to-r from-blue-50/50 via-white to-blue-50/50 dark:from-blue-950/20 dark:via-gray-900 dark:to-blue-950/20 animate-pulse">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
              <div className="text-center">
                <p className="text-lg font-medium">
                  <span className="text-gray-700 dark:text-gray-300">Executing MCP tool: </span>
                  <span className="animate-shimmer text-blue-600 dark:text-blue-400 font-semibold">
                    {displayToolName}
                  </span>
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Processing your request...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Details - Only show when explicitly opened */}
        {isOpen && (
          <div className="border-t border-gray-100 dark:border-gray-800">
            {/* Request Parameters - Primary focus */}
            <div className="px-4 py-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Request Parameters
                  </h4>
                  {parameterSourceInfo && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                      Source: {parameterSourceInfo}
                    </span>
                  )}
                </div>
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                  <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap">
                    {(() => {
                      // Enhanced parameter display with debugging
                      console.log(`[McpToolBox] 🖥️ RENDERING parameters for ${toolCall.toolName}:`);
                      console.log(`[McpToolBox]   - parametersToDisplay:`, parametersToDisplay);
                      console.log(`[McpToolBox]   - parameterSourceInfo:`, parameterSourceInfo);
                      console.log(`[McpToolBox]   - persistentState:`, persistentState?.status);

                      // Display parameters from the computed state
                      if (parametersToDisplay && Object.keys(parametersToDisplay).length > 0) {
                        // 🎯 PARAMETER ORDER FIX: Custom formatting for Gmail find_email tools
                        if (toolCall.toolName.includes('find_email') && parametersToDisplay.instructions && parametersToDisplay.query) {
                          console.log(`[McpToolBox] 🎯 Using custom parameter order for Gmail find_email`);
                          const customOrderedParams = {
                            instructions: parametersToDisplay.instructions,
                            query: parametersToDisplay.query
                          };
                          const paramStr = JSON.stringify(customOrderedParams, null, 2);
                          console.log(`[McpToolBox] ✅ Displaying ${Object.keys(customOrderedParams).length} parameters with custom order`);
                          return paramStr;
                        } else {
                          const paramStr = JSON.stringify(parametersToDisplay, null, 2);
                          console.log(`[McpToolBox] ✅ Displaying ${Object.keys(parametersToDisplay).length} parameters`);
                          return paramStr;
                        }
                      }

                      // If no parameters in computed state, try fallbacks with debugging
                      if (originalParameters && Object.keys(originalParameters).length > 0) {
                        console.log(`[McpToolBox] ⚠️ Fallback to originalParameters:`, originalParameters);
                        return JSON.stringify(originalParameters, null, 2);
                      }

                      if (toolCall.args && Object.keys(toolCall.args).length > 0) {
                        console.log(`[McpToolBox] ⚠️ Fallback to toolCall.args:`, toolCall.args);
                        return JSON.stringify(toolCall.args, null, 2);
                      }

                      // If no parameters in any source, show appropriate message
                      if (persistentState === null) {
                        console.log(`[McpToolBox] ⏳ Still loading persistent state`);
                        return "Loading parameters...";
                      }

                      console.log(`[McpToolBox] ❌ No parameters found from any source`);
                      return "No parameters available for this tool call.";
                    })()}
                  </pre>
                </div>
              </div>
            </div>

            {/* Tool Information - Secondary */}
            {explanationText && (
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Tool Information
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {explanationText}
                  </p>
                </div>
              </div>
            )}

            {/* Results Section - Only show in details */}
            {userVisibleResult && (status === 'completed' || status === 'error') && (
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {userVisibleResult.isError ? "Error Details" : "Result"}
                  </h4>
                  <ToolResultRenderer
                    data={userVisibleResult.result}
                    toolName={toolCall.toolName}
                    isError={userVisibleResult.isError || false}
                  />
                </div>
              </div>
            )}


          </div>
        )}

        {/* Action Buttons - Show outside dropdown for immediate access */}
        {status === 'waiting' && requireExplicitApproval && (
          <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 rounded-b-xl">
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancel}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all",
                  "text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600",
                  "hover:bg-gray-50 dark:hover:bg-gray-600",
                  "focus:outline-none focus:ring-2 focus:ring-gray-500/20"
                )}
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={handleApprove}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all",
                  "text-white bg-blue-600 hover:bg-blue-700",
                  "shadow-sm hover:shadow-md",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                )}
              >
                <Play className="w-4 h-4" />
                Run Tool
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 
