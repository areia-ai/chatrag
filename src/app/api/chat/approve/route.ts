import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v3';
import { ToolExecutionStateService } from '@/lib/tool-execution-state';
import { devLog } from '@/lib/dev-logger';
import { formatToolResultUniversally } from '@/lib/universal-tool-formatter';
import { findImagesWithFallback } from '@/lib/mcp/image-context-manager';
import { isUrlMcpCompatible } from '@/lib/mcp/url-validator';

// Global cache for Gmail data chaining
const global_cache = globalThis as any;
if (!global_cache.gmailCache) {
  global_cache.gmailCache = {
    lastFoundEmail: null as any,
    recentEmails: [] as Array<{
      id: string;
      threadId?: string;
      from: string;
      subject: string;
      snippet?: string;
      timestamp: number;
    }>,
    timestamp: null as number | null,
    MAX_CACHED_EMAILS: 10 // Keep last 10 emails in cache
  };
}

// Global cache for MCP tools persistence
if (!global_cache.mcpToolsCache) {
  global_cache.mcpToolsCache = new Map<string, { tools: any[], timestamp: number }>();
}

/**
 * Universal Parameter Mapping System
 * Maps common AI model parameters to MCP tool schema expectations
 * Works with any MCP server by detecting parameter patterns
 */
function applyUniversalParameterMapping(toolName: string, params: any): any {
  const mappedParams = { ...params };
  const lowerToolName = toolName.toLowerCase();
  
  // Define universal parameter mapping patterns
  const parameterMappings = {
    // Search/Query tools (find, search, get, fetch, list)
    search: {
      patterns: ['find', 'search', 'get', 'fetch', 'list', 'query'],
      mappings: {
        'instructions': 'query',
        'text': 'query', 
        'prompt': 'query',
        'description': 'query'
      }
    },
    
    // Creation tools (create, make, generate, add, post)
    create: {
      patterns: ['create', 'make', 'generate', 'add', 'post', 'send'],
      mappings: {
        'instructions': 'content',
        'text': 'content',
        'message': 'content',
        'description': 'content'
      }
    },
    
    // Processing tools (process, analyze, transform, convert)
    process: {
      patterns: ['process', 'analyze', 'transform', 'convert', 'parse'],
      mappings: {
        'instructions': 'input',
        'content': 'input',
        'text': 'input',
        'data': 'input'
      }
    },
    
    // Communication tools (email, message, chat, notify)
    communicate: {
      patterns: ['email', 'message', 'chat', 'notify', 'send', 'reply'],
      mappings: {
        'instructions': 'body',
        'content': 'body',
        'text': 'body',
        'message': 'body'
      }
    },
    
    // File/Upload tools (upload, file, drive, storage)
    upload: {
      patterns: ['upload', 'file', 'drive', 'storage'],
      mappings: {
        'input': 'instructions',
        'text': 'instructions',
        'message': 'instructions',
        'description': 'instructions'
      }
    }
  };
  
  // Apply mappings based on tool patterns
  for (const [category, config] of Object.entries(parameterMappings)) {
    const matchesPattern = config.patterns.some(pattern => lowerToolName.includes(pattern));
    
    if (matchesPattern) {
      for (const [sourceParam, targetParam] of Object.entries(config.mappings)) {
        if (mappedParams[sourceParam] && !mappedParams[targetParam]) {
          mappedParams[targetParam] = mappedParams[sourceParam];
          devLog.verbose(`🌐 [UNIVERSAL MAPPING] ${category}: ${sourceParam} → ${targetParam} for ${toolName}`);
        }
      }
      break; // Use first matching pattern to avoid conflicts
    }
  }
  
  return mappedParams;
}

/**
 * Universal Parameter Transformation for MCP Tools
 * This function applies transformations BEFORE storing in persistent state
 * Supports any MCP server type following JSON-RPC 2.0 specifications
 */
async function transformToolParameters(toolName: string, originalParams: any): Promise<any> {
  let optimizedParams = { ...originalParams };

  console.log(`🔧 [TRANSFORM] Starting transformation for tool: ${toolName}`);
  console.log(`🔧 [TRANSFORM] Original params:`, JSON.stringify(originalParams, null, 2));

  // 🔧 FIX: Base64 Detection and Conversion
  // Check for Base64 data in parameters and convert to downloadable URLs
  if (toolName.includes('google_drive') || toolName.includes('drive_upload') || 
      toolName.includes('uploadFile') || toolName.includes('upload_file') ||
      toolName.includes('gmail_')) {
    
    for (const [key, value] of Object.entries(originalParams)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        console.log(`🔧 [TRANSFORM] ⚠️ Found Base64 image data in parameter '${key}', converting to downloadable URL`);
        
        try {
          const { processAttachedImages } = await import('@/lib/mcp/image-context-manager');
          const sessionId = originalParams.sessionId || originalParams.session_id || `transform_${crypto.randomUUID()}`;
          
          const attachedImages = [{
            name: `converted-image-${Date.now()}.png`,
            dataUrl: value
          }];
          
          const downloadableUrls = await processAttachedImages(sessionId, attachedImages);
          
          if (downloadableUrls.length > 0) {
            optimizedParams[key] = downloadableUrls[0];
            console.log(`🔧 [TRANSFORM] ✅ Successfully converted Base64 to URL for parameter '${key}':`, downloadableUrls[0]);
          } else {
            console.log(`🔧 [TRANSFORM] ❌ Failed to convert Base64 to URL for parameter '${key}', keeping original`);
          }
        } catch (error) {
          console.error(`🔧 [TRANSFORM] ❌ Error converting Base64 to URL for parameter '${key}':`, error);
        }
      }
    }
  }

  // 🖼️ ENHANCED IMAGE URL INJECTION FOR MCP COMPATIBILITY
  console.log(`🔧 [TRANSFORM] Checking if tool needs image injection:`);
  console.log(`🔧 [TRANSFORM] Tool name: ${toolName}`);
  console.log(`🔧 [TRANSFORM] Is Google Drive tool:`, toolName.includes('google_drive') || toolName.includes('drive_upload') || toolName.includes('uploadFile') || toolName.includes('upload_file'));
  console.log(`🔧 [TRANSFORM] Has attachedImages:`, !!originalParams.attachedImages);
  console.log(`🔧 [TRANSFORM] Has downloadableUrls:`, !!originalParams.downloadableUrls);
  
  if (toolName.includes('google_drive') || toolName.includes('drive_upload') || 
      toolName.includes('uploadFile') || toolName.includes('upload_file')) {
    
    console.log(`🔧 [TRANSFORM] ✓ Detected Google Drive tool - checking for images`);
    
    devLog.verbose('🖼️ [IMAGE URL INJECTION] Detected Google Drive tool - checking for images');
    devLog.verbose('🖼️ [IMAGE URL INJECTION] Attached images count:', originalParams.attachedImages?.length || 0);
    devLog.verbose('🖼️ [IMAGE URL INJECTION] Downloadable URLs count:', originalParams.downloadableUrls?.length || 0);
    
    try {
      let imageUrls: string[] = [];
      let injectionSource = 'none';
      
      // Priority 1: Use downloadableUrls if directly provided
      if (originalParams.downloadableUrls && Array.isArray(originalParams.downloadableUrls)) {
        imageUrls = originalParams.downloadableUrls;
        injectionSource = 'direct_params';
        devLog.verbose('🖼️ [IMAGE URL INJECTION] Using directly provided downloadableUrls:', imageUrls.length);
      } else {
        // Priority 2: Enhanced lookup with fallback strategies
        const sessionId = originalParams.sessionId || 
                         originalParams.chatId || 
                         originalParams._sessionId;
        
        console.log(`🔧 [TRANSFORM] Using enhanced lookup for sessionId: ${sessionId}`);
        
        if (sessionId) {
          // Use the enhanced fallback method from ImageContextManager
          imageUrls = findImagesWithFallback(sessionId);
          injectionSource = 'enhanced_context_manager';
          
          if (imageUrls.length > 0) {
            console.log(`🔧 [TRANSFORM] ✅ Enhanced lookup found ${imageUrls.length} URLs`);
            devLog.verbose('🖼️ [IMAGE URL INJECTION] Enhanced lookup successful:', imageUrls.length);
          } else {
            console.log(`🔧 [TRANSFORM] ❌ Enhanced lookup failed, trying global context fallback`);
            
            // Final fallback: Try global context
            if ((globalThis as any).mcpImageContext) {
              const availableKeys = Object.keys((globalThis as any).mcpImageContext);
              console.log(`🔧 [TRANSFORM] Global context fallback - trying ${availableKeys.length} keys`);
              
              for (const key of availableKeys) {
                const context = (globalThis as any).mcpImageContext[key];
                if (context && context.downloadableUrls && context.downloadableUrls.length > 0) {
                  imageUrls = context.downloadableUrls;
                  injectionSource = 'global_context_fallback';
                  console.log(`🔧 [TRANSFORM] ✅ Global context fallback successful: ${key} -> ${imageUrls.length} URLs`);
                  break;
                }
              }
            }
          }
        } else {
          devLog.warn('🖼️ [IMAGE URL INJECTION] No session ID available for lookup');
        }
      }
      
      // If we have URLs, inject them into the parameters
      if (imageUrls && imageUrls.length > 0) {
        devLog.verbose('🖼️ [IMAGE URL INJECTION] Injecting image URLs:', imageUrls.length);
        
        // For Google Drive tools, inject the image URL as the 'file' parameter
        if (imageUrls.length === 1) {
          optimizedParams.file = imageUrls[0];
          optimizedParams.file_url = imageUrls[0]; // Also set file_url for compatibility
          optimizedParams.filename = optimizedParams.filename || 'attached-image.png';
          console.log(`🔧 [TRANSFORM] ✅ SET FILE PARAMETERS:`);
          console.log(`🔧 [TRANSFORM]   - file: ${imageUrls[0]}`);
          console.log(`🔧 [TRANSFORM]   - file_url: ${imageUrls[0]}`);
          console.log(`🔧 [TRANSFORM]   - filename: ${optimizedParams.filename}`);
          devLog.verbose('🖼️ [IMAGE URL INJECTION] Injected single image URL as file parameter');
        } else {
          optimizedParams.files = imageUrls;
          optimizedParams.file_urls = imageUrls; // Also set file_urls for compatibility
          console.log(`🔧 [TRANSFORM] ✅ SET FILES PARAMETERS: ${imageUrls.length} URLs`);
          devLog.verbose('🖼️ [IMAGE URL INJECTION] Injected multiple image URLs as files parameter');
        }
        
        // Add context for debugging
        optimizedParams._imageContext = {
          sessionId: originalParams.sessionId,
          imageCount: imageUrls.length,
          source: injectionSource
        };
      } else {
        console.log(`🔧 [TRANSFORM] ❌ NO IMAGE URLS FOUND FOR INJECTION`);
        console.log(`🔧 [TRANSFORM] Direct downloadableUrls:`, !!originalParams.downloadableUrls);
        console.log(`🔧 [TRANSFORM] Session ID:`, originalParams.sessionId);
        devLog.warn('🖼️ [IMAGE URL INJECTION] No image URLs available for injection');
      }
      
      // Always remove attachedImages from final parameters to avoid confusion
      delete optimizedParams.attachedImages;
      
    } catch (error) {
      devLog.error('🖼️ [IMAGE URL INJECTION] Error injecting image URLs:', error);
      // Continue with transformation even if image URL injection fails
      delete optimizedParams.attachedImages;
    }
  } else {
    console.log(`🔧 [TRANSFORM] ❌ Skipping image injection for tool: ${toolName}`);
    console.log(`🔧 [TRANSFORM] Reason: Not a Google Drive tool`);
  }

  // 🔗 URL VALIDATION FOR MCP COMPATIBILITY: Ensure existing URLs are MCP-compatible
  const urlFields = ['file_url', 'url', 'media_url', 'image_url', 'video_url', 'attachment_url'];
  for (const field of urlFields) {
    if (optimizedParams[field] && typeof optimizedParams[field] === 'string') {
      const url = optimizedParams[field];
      
      // Check if URL needs processing for MCP compatibility
      if (!isUrlMcpCompatible(url)) {
        devLog.verbose('🔗 [URL VALIDATION] URL not MCP-compatible:', url.substring(0, 100));
        
        // If it's a blob or data URL, mark it for upload processing
        if (url.startsWith('blob:') || url.startsWith('data:')) {
          devLog.verbose('🔗 [URL VALIDATION] Marking blob/data URL for upload processing');
          optimizedParams._requiresUpload = true;
          optimizedParams._originalUrlField = field;
        }
      } else {
        devLog.verbose('🔗 [URL VALIDATION] URL is MCP-compatible:', url.substring(0, 100));
      }
    }
  }

  // 🌐 UNIVERSAL PARAMETER MAPPING: Apply common transformations for any MCP tool
  // These patterns work across different MCP server implementations
  
  // 1. Handle common AI model parameter patterns
  if (optimizedParams.instructions && !optimizedParams.query && !optimizedParams.input) {
    // Many MCP tools expect 'query' instead of 'instructions'
    if (toolName.includes('search') || toolName.includes('find') || toolName.includes('get')) {
      devLog.verbose('🌐 [UNIVERSAL TRANSFORM] Converting instructions → query for search-type tool');
      optimizedParams.query = optimizedParams.instructions;
    }
  }
  
  // 2. Handle input parameter standardization
  if (optimizedParams.text && !optimizedParams.input && !optimizedParams.content) {
    // Some tools expect 'input' instead of 'text'
    if (toolName.includes('process') || toolName.includes('analyze') || toolName.includes('generate')) {
      devLog.verbose('🌐 [UNIVERSAL TRANSFORM] Converting text → input for processing tool');
      optimizedParams.input = optimizedParams.text;
    }
  }
  
  // 3. Handle message/content parameter standardization
  if (optimizedParams.message && !optimizedParams.content && !optimizedParams.body) {
    // Some tools expect 'content' or 'body' instead of 'message'
    if (toolName.includes('create') || toolName.includes('send') || toolName.includes('post')) {
      devLog.verbose('🌐 [UNIVERSAL TRANSFORM] Converting message → content for creation tool');
      optimizedParams.content = optimizedParams.message;
    }
  }
  
  // 4. Apply universal parameter mapping based on tool schema patterns
  optimizedParams = applyUniversalParameterMapping(toolName, optimizedParams);

  // 🎯 CRITICAL FIX: Transform instructions → query for Gmail find_email tools
  // The Zapier MCP client expects 'query' parameter, but AI sends 'instructions'
  if (toolName.includes('find_email') && optimizedParams.instructions && !optimizedParams.query) {
    devLog.verbose('🔍 [PARAM TRANSFORM] Converting instructions to query parameter for Gmail find_email');
    devLog.verbose('🔍 [PARAM TRANSFORM] Original instructions:', optimizedParams.instructions);
    
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
    
    devLog.verbose('🔍 [PARAM TRANSFORM] Transformed query:', searchQuery);
    devLog.verbose('🔍 [PARAM TRANSFORM] Final parameter count:', Object.keys(optimizedParams).length);
    devLog.verbose('🔍 [PARAM TRANSFORM] Parameter order:', Object.keys(optimizedParams));
  }

  // 📅 CALENDAR FIX: Transform instructions → query for Calendar tools
  // Similar to Gmail, Zapier Calendar tools expect 'query' parameter
  if ((toolName.includes('find_event') || toolName.includes('calendar') || toolName.includes('event')) && 
      optimizedParams.instructions && !optimizedParams.query) {
    devLog.verbose('📅 [CALENDAR TRANSFORM] Converting instructions to query parameter for Calendar tool');
    devLog.verbose('📅 [CALENDAR TRANSFORM] Original instructions:', optimizedParams.instructions);
    
    // Transform instructions to Calendar search query
    let calendarQuery = optimizedParams.instructions;
    
    // Parse natural language time expressions
    const lowerQuery = calendarQuery.toLowerCase();
    if (lowerQuery.includes('next') || lowerQuery.includes('upcoming') || lowerQuery.includes('future')) {
      // For "next event" or "upcoming events", set proper time boundaries
      calendarQuery = 'next events';
    } else if (lowerQuery.includes('today')) {
      calendarQuery = 'today events';
    } else if (lowerQuery.includes('tomorrow')) {
      calendarQuery = 'tomorrow events';
    } else if (lowerQuery.includes('this week')) {
      calendarQuery = 'this week events';
    }
    
    // 🎯 PARAMETER ORDER FIX: Force explicit property order for Calendar tools
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
      value: calendarQuery,
      writable: true,
      enumerable: true,
      configurable: true
    });
    
    devLog.verbose('📅 [CALENDAR TRANSFORM] Transformed query:', calendarQuery);
    devLog.verbose('📅 [CALENDAR TRANSFORM] Final parameter count:', Object.keys(optimizedParams).length);
    devLog.verbose('📅 [CALENDAR TRANSFORM] Parameter order:', Object.keys(optimizedParams));
  }

  // 📧 GMAIL PARAMETER SIMPLIFICATION: Handle attachment URL to file parameter conversion
  // AI sends attachment_url, but Zapier expects 'file' parameter
  if (toolName.includes('gmail_')) {
    devLog.verbose('📧 [GMAIL TRANSFORM] Processing Gmail parameters');
    
    // 🖼️ ENHANCED IMAGE CONTEXT INTEGRATION: Check for images in session context
    // Note: metadata might not be available in transformToolParameters, so we skip this for now
    // This functionality is handled in the main image injection section later in the flow
    const sessionIdFromMetadata = (originalParams as any)?._sessionId || (originalParams as any)?.sessionId;
    if (!optimizedParams.attachment_url && !optimizedParams.file && sessionIdFromMetadata) {
      devLog.verbose('📧 [GMAIL TRANSFORM] No explicit attachment - checking session context for images');
      
      try {
        // Try to get image URL from Enhanced Image Context Manager
        const { findImagesWithFallback } = await import('@/lib/mcp/image-context-manager');
        
        const imageUrls = findImagesWithFallback(sessionIdFromMetadata);
        if (imageUrls && imageUrls.length > 0) {
          const imageUrl = imageUrls[0];
          devLog.verbose('📧 [GMAIL TRANSFORM] ✅ Found image URL from session context:', imageUrl);
          
          // Set both file and attachment_url for Gmail tools
          optimizedParams.attachment_url = imageUrl;
          optimizedParams.file = imageUrl.includes('supabase.co/storage/v1/object/public/') 
            ? `${imageUrl}?download`
            : imageUrl;
          
          devLog.verbose('📧 [GMAIL TRANSFORM] ✅ Injected image URL into Gmail parameters');
        }
      } catch (imageContextError) {
        devLog.verbose('📧 [GMAIL TRANSFORM] ⚠️ Enhanced Image Context Manager not available:', imageContextError);
      }
      
      // Fallback to global context if Enhanced Image Context Manager failed
      if (!optimizedParams.attachment_url && (globalThis as any).mcpImageContext) {
        const imageContext = (globalThis as any).mcpImageContext[sessionIdFromMetadata];
        
        if (imageContext && imageContext.imageUrl) {
          devLog.verbose('📧 [GMAIL TRANSFORM] ✅ Found image URL from global context:', imageContext.imageUrl);
          optimizedParams.attachment_url = imageContext.imageUrl;
          optimizedParams.file = imageContext.imageUrl.includes('supabase.co/storage/v1/object/public/') 
            ? `${imageContext.imageUrl}?download`
            : imageContext.imageUrl;
        } else if (imageContext && imageContext.downloadableUrls && imageContext.downloadableUrls.length > 0) {
          const imageUrl = imageContext.downloadableUrls[0];
          devLog.verbose('📧 [GMAIL TRANSFORM] ✅ Found downloadable URL from global context:', imageUrl);
          optimizedParams.attachment_url = imageUrl;
          optimizedParams.file = imageUrl.includes('supabase.co/storage/v1/object/public/') 
            ? `${imageUrl}?download`
            : imageUrl;
        }
      }
      
      // 🚨 EMERGENCY FALLBACK: Check all available image contexts as last resort
      if (!optimizedParams.attachment_url && (globalThis as any).mcpImageContext) {
        devLog.verbose('📧 [GMAIL TRANSFORM] ⚠️ No session-specific image found, checking all available contexts');
        
        const allContexts = Object.values((globalThis as any).mcpImageContext);
        for (const ctx of allContexts) {
          if (ctx && typeof ctx === 'object' && (ctx as any).imageUrl) {
            devLog.verbose('📧 [GMAIL TRANSFORM] 🚨 Emergency fallback: Using available image URL:', (ctx as any).imageUrl);
            optimizedParams.attachment_url = (ctx as any).imageUrl;
            optimizedParams.file = (ctx as any).imageUrl.includes('supabase.co/storage/v1/object/public/') 
              ? `${(ctx as any).imageUrl}?download`
              : (ctx as any).imageUrl;
            break;
          } else if (ctx && typeof ctx === 'object' && (ctx as any).downloadableUrls && (ctx as any).downloadableUrls.length > 0) {
            const emergencyUrl = (ctx as any).downloadableUrls[0];
            devLog.verbose('📧 [GMAIL TRANSFORM] 🚨 Emergency fallback: Using available downloadable URL:', emergencyUrl);
            optimizedParams.attachment_url = emergencyUrl;
            optimizedParams.file = emergencyUrl.includes('supabase.co/storage/v1/object/public/') 
              ? `${emergencyUrl}?download`
              : emergencyUrl;
            break;
          }
        }
      }
    }
    
    // Transform attachment_url to file parameter with download option
    if (optimizedParams.attachment_url) {
      const attachmentUrl = optimizedParams.attachment_url;
      // Add ?download for Supabase URLs
      const fileUrl = attachmentUrl.includes('supabase.co/storage/v1/object/public/') 
        ? `${attachmentUrl}?download`
        : attachmentUrl;
      
      optimizedParams.file = fileUrl;
      delete optimizedParams.attachment_url;
      
      devLog.verbose('📧 [GMAIL TRANSFORM] Converted attachment_url to file:', fileUrl);
    }
    
    // Ensure body_type is set for HTML emails
    if (optimizedParams.body && !optimizedParams.body_type) {
      optimizedParams.body_type = 'html';
      // Convert newlines to <br> for HTML
      optimizedParams.body = optimizedParams.body.replace(/\n/g, '<br>');
    }
    
    devLog.verbose('📧 [GMAIL TRANSFORM] Final parameters:', optimizedParams);
    
    return optimizedParams;
  }
  
  // Legacy input field handling for backward compatibility - only if we still get input strings
  if ((toolName.includes('create_draft_reply') || toolName.includes('reply_to_email') || 
       toolName.includes('gmail_reply') || toolName.includes('gmail_create_draft')) && 
      optimizedParams.input && typeof optimizedParams.input === 'string') {
    devLog.verbose('📧 [GMAIL TRANSFORM] Legacy mode: Converting input field to structured parameters');
    devLog.verbose('📧 [GMAIL TRANSFORM] Original input:', optimizedParams.input);
    
    const rawInput = optimizedParams.input;
    const structuredParams: any = {};
    
    // Parse the raw email input to extract structured fields
    const lines = rawInput.split('\n');
    const currentSection = '';
    const bodyLines: string[] = [];
    let foundBodyStart = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Extract To field
      if (line.startsWith('To:')) {
        structuredParams.to = line.replace('To:', '').trim();
        continue;
      }
      
      // Extract Subject field
      if (line.startsWith('Subject:')) {
        structuredParams.subject = line.replace('Subject:', '').trim();
        continue;
      }
      
      // Extract CC field if present
      if (line.startsWith('CC:') || line.startsWith('Cc:')) {
        structuredParams.cc = line.replace(/CC:|Cc:/, '').trim();
        continue;
      }
      
      // Extract BCC field if present
      if (line.startsWith('BCC:') || line.startsWith('Bcc:')) {
        structuredParams.bcc = line.replace(/BCC:|Bcc:/, '').trim();
        continue;
      }
      
      // Extract Attachment field
      if (line.startsWith('Attachment:')) {
        const attachmentUrl = line.replace('Attachment:', '').trim();
        if (attachmentUrl && attachmentUrl.startsWith('http')) {
          structuredParams.attachment_url = attachmentUrl;
          devLog.verbose('📧 [GMAIL TRANSFORM] Extracted attachment URL:', attachmentUrl);
        }
        continue; // Don't add to body
      }
      
      // Everything else after headers is body content
      if (line === '' && !foundBodyStart && (structuredParams.to || structuredParams.subject)) {
        foundBodyStart = true;
        continue;
      }
      
      if (foundBodyStart || (!line.includes(':') && i > 0)) {
        bodyLines.push(lines[i]); // Keep original formatting including empty lines
      }
    }
    
    // Set body content
    if (bodyLines.length > 0) {
      structuredParams.body = bodyLines.join('\n').trim();
    }
    
    // Get thread_id from Gmail cache if available (for proper reply threading)
    if (global_cache.gmailCache?.lastFoundEmail?.thread_id) {
      structuredParams.thread_id = global_cache.gmailCache.lastFoundEmail.thread_id;
      devLog.verbose('📧 [GMAIL TRANSFORM] Using cached thread_id:', structuredParams.thread_id);
    }
    
    // If no To field was extracted, try to get it from cache
    if (!structuredParams.to && global_cache.gmailCache?.lastFoundEmail?.from) {
      structuredParams.to = global_cache.gmailCache.lastFoundEmail.from;
      devLog.verbose('📧 [GMAIL TRANSFORM] Using cached sender as To field:', structuredParams.to);
    }
    
    // If still no To field, try to extract from the original user message or cache
    if (!structuredParams.to) {
      // Check if we have access to the original user message
      const userMessage = optimizedParams._userMessage || '';
      
      devLog.verbose('📧 [GMAIL TRANSFORM] No To field found, checking user message and cache for email hints');
      devLog.verbose('📧 [GMAIL TRANSFORM] User message:', userMessage);
      
      // Look for common patterns in the user message
      // 1. Full email addresses
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emailMatches = userMessage.match(emailRegex);
      
      if (emailMatches && emailMatches.length > 0) {
        structuredParams.to = emailMatches[0];
        devLog.verbose('📧 [GMAIL TRANSFORM] Extracted email from user message:', structuredParams.to);
      } else {
        // 2. Look for names or usernames mentioned in the user message
        const namePatterns = [
          /(?:to|for|email|reply to|draft to)\s+(\w+)(?:\s|,|$)/i,
          /(\w+)(?:\s+and\s+their|'s)\s+(?:email|message)/i,
          /write\s+(?:a\s+)?(?:draft|email|reply)\s+to\s+(\w+)/i
        ];
        
        let extractedName = null;
        for (const pattern of namePatterns) {
          const match = userMessage.match(pattern);
          if (match && match[1]) {
            extractedName = match[1].toLowerCase();
            devLog.verbose('📧 [GMAIL TRANSFORM] Extracted name from user message:', extractedName);
            break;
          }
        }
        
        if (extractedName && global_cache.gmailCache?.recentEmails) {
            devLog.verbose('📧 [GMAIL TRANSFORM] Searching cache for name:', extractedName);
            devLog.verbose('📧 [GMAIL TRANSFORM] Cached emails:', global_cache.gmailCache.recentEmails.map((e: any) => ({ from: e.from, fromName: e.fromName })));
            
            for (const cachedEmail of global_cache.gmailCache.recentEmails) {
              const cachedFrom = cachedEmail.from;
              const cachedFromName = cachedEmail.fromName || '';
              
              // Check both email address and name fields for matches
              if (cachedFrom && cachedFrom.toLowerCase().includes(extractedName)) {
                structuredParams.to = cachedFrom;
                devLog.verbose('📧 [GMAIL TRANSFORM] Matched partial email to cached sender:', structuredParams.to);
                
                // Also set thread_id if this is the email being replied to
                if (cachedEmail.threadId) {
                  structuredParams.thread_id = cachedEmail.threadId;
                  devLog.verbose('📧 [GMAIL TRANSFORM] Also using thread_id from matched email:', structuredParams.thread_id);
                }
                break;
              } else if (cachedFromName && cachedFromName.toLowerCase().includes(extractedName)) {
                structuredParams.to = cachedFrom;
                devLog.verbose('📧 [GMAIL TRANSFORM] Matched name to cached sender:', structuredParams.to);
                
                // Also set thread_id if this is the email being replied to
                if (cachedEmail.threadId) {
                  structuredParams.thread_id = cachedEmail.threadId;
                  devLog.verbose('📧 [GMAIL TRANSFORM] Also using thread_id from matched email:', structuredParams.thread_id);
                }
                break;
              }
            }
          }
          
          // If still no match, check if we have a domain hint and extracted name
          if (!structuredParams.to && extractedName && userMessage.toLowerCase().includes('@proton.me')) {
            structuredParams.to = `${extractedName}@proton.me`;
            devLog.verbose('📧 [GMAIL TRANSFORM] Constructed email with domain hint:', structuredParams.to);
          }
      }
    }
    
    // If no Subject was extracted, create a reply subject from cache
    if (!structuredParams.subject && global_cache.gmailCache?.lastFoundEmail?.subject) {
      const originalSubject = global_cache.gmailCache.lastFoundEmail.subject;
      structuredParams.subject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
      devLog.verbose('📧 [GMAIL TRANSFORM] Using cached subject as reply:', structuredParams.subject);
    }
    
    // 🎯 PARAMETER ORDER FIX: Create properly ordered parameters for Zapier Gmail API
    optimizedParams = {};
    
    // Define properties in the order Zapier expects them
    if (structuredParams.to) {
      Object.defineProperty(optimizedParams, 'to', {
        value: structuredParams.to,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    
    if (structuredParams.subject) {
      Object.defineProperty(optimizedParams, 'subject', {
        value: structuredParams.subject,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    
    if (structuredParams.body) {
      Object.defineProperty(optimizedParams, 'body', {
        value: structuredParams.body,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    
    if (structuredParams.thread_id) {
      Object.defineProperty(optimizedParams, 'thread_id', {
        value: structuredParams.thread_id,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    
    if (structuredParams.cc) {
      Object.defineProperty(optimizedParams, 'cc', {
        value: structuredParams.cc,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    
    if (structuredParams.bcc) {
      Object.defineProperty(optimizedParams, 'bcc', {
        value: structuredParams.bcc,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    
    
    devLog.verbose('📧 [GMAIL TRANSFORM] Structured parameters:', structuredParams);
    devLog.verbose('📧 [GMAIL TRANSFORM] Final parameter count:', Object.keys(optimizedParams).length);
    devLog.verbose('📧 [GMAIL TRANSFORM] Parameter order:', Object.keys(optimizedParams));
  }

  // 📁 GOOGLE DRIVE UPLOAD FIX: Transform parameters for Google Drive tools
  // The AI sends generic parameters, but Zapier expects specific fields
  if ((toolName.includes('google_drive') || toolName.includes('drive_upload') || 
       toolName.includes('uploadFile') || toolName.includes('upload_file'))) {
    devLog.verbose('📁 [DRIVE TRANSFORM] Detected Google Drive upload tool');
    devLog.verbose('📁 [DRIVE TRANSFORM] Original params:', optimizedParams);
    
    // First, ensure we have instructions parameter if AI sent input
    if ((optimizedParams.input || optimizedParams.query) && !optimizedParams.instructions) {
      optimizedParams.instructions = optimizedParams.input || optimizedParams.query;
      devLog.verbose('📁 [DRIVE TRANSFORM] Set instructions from input/query:', optimizedParams.instructions);
    }
    
    // 🖼️ CRITICAL: Handle image processing promise if it exists
    let fileUrl = optimizedParams.file_url || optimizedParams.url || optimizedParams.media_url || 
                  optimizedParams.image_url || optimizedParams.video_url;
    
    // If we have an image processing promise, we need to resolve it to get downloadable URLs
    if (optimizedParams._imageProcessingPromise) {
      devLog.verbose('📁 [DRIVE TRANSFORM] Resolving image processing promise...');
      
      try {
        // This is where the async magic happens - we resolve the promise to get URLs
        const downloadableUrls = await optimizedParams._imageProcessingPromise;
        
        if (downloadableUrls && downloadableUrls.length > 0) {
          // Use the first downloadable URL (for single file uploads)
          fileUrl = downloadableUrls[0];
          devLog.verbose('📁 [DRIVE TRANSFORM] ✅ Got downloadable URL from image processing:', fileUrl);
          
          // Also store all URLs in case there are multiple files
          optimizedParams._processedImageUrls = downloadableUrls;
        } else {
          devLog.warn('📁 [DRIVE TRANSFORM] ⚠️ Image processing returned no URLs');
        }
        
        // Clean up the promise from parameters
        delete optimizedParams._imageProcessingPromise;
        
      } catch (error) {
        devLog.error('📁 [DRIVE TRANSFORM] ❌ Failed to process attached images:', error);
        // Continue with existing URL if available
        delete optimizedParams._imageProcessingPromise;
      }
    }
    
    devLog.verbose('📁 [DRIVE TRANSFORM] File URL:', fileUrl);
    
    // Only process if it's a Supabase URL (our generated media)
    if (fileUrl && typeof fileUrl === 'string' && fileUrl.includes('supabase')) {
      try {
        devLog.verbose('📁 [DRIVE TRANSFORM] Fetching file from Supabase URL...');
        
        // Note: We'll need to handle this asynchronously in the actual tool execution
        // For now, we'll pass the URL and handle the fetch in the POST handler
        
        // Extract filename from URL or use defaults
        const urlParts = fileUrl.split('/');
        const urlFilename = urlParts[urlParts.length - 1] || '';
        
        // Determine filename
        let filename = optimizedParams.filename || optimizedParams.file_name || urlFilename;
        
        // If no extension, try to determine from URL or content type
        if (!filename.includes('.')) {
          if (fileUrl.includes('chat-images')) {
            filename += '.png';
          } else if (fileUrl.includes('chat-videos')) {
            filename += '.mp4';
          } else if (fileUrl.includes('3d-models')) {
            filename += '.glb';
          }
        }
        
        // Determine MIME type
        let mimeType = optimizedParams.mime_type || optimizedParams.mimeType;
        if (!mimeType) {
          if (filename.includes('.png')) mimeType = 'image/png';
          else if (filename.includes('.jpg') || filename.includes('.jpeg')) mimeType = 'image/jpeg';
          else if (filename.includes('.gif')) mimeType = 'image/gif';
          else if (filename.includes('.webp')) mimeType = 'image/webp';
          else if (filename.includes('.mp4')) mimeType = 'video/mp4';
          else if (filename.includes('.webm')) mimeType = 'video/webm';
          else if (filename.includes('.glb')) mimeType = 'model/gltf-binary';
          else mimeType = 'application/octet-stream';
        }
        
        // Extract folder information
        const folder = optimizedParams.folder || optimizedParams.folder_name || optimizedParams.directory || '';
        
        // 🎯 PARAMETER ORDER FIX: Create properly ordered parameters for Google Drive
        const structuredParams = {
          _fileUrl: fileUrl, // Internal use, will be removed before sending to Zapier
          instructions: optimizedParams.instructions || `Upload file ${filename} to Google Drive`,
          filename: filename,
          mimeType: mimeType,
          folder: folder,
          drive: 'My Drive' // Default to user's main drive for Zapier
        };
        
        optimizedParams = {};
        
        // CRITICAL: Zapier expects 'instructions' as required parameter
        Object.defineProperty(optimizedParams, 'instructions', {
          value: structuredParams.instructions,
          writable: true,
          enumerable: true,
          configurable: true
        });
        
        // Keep the file URL for async processing
        Object.defineProperty(optimizedParams, '_fileUrl', {
          value: structuredParams._fileUrl,
          writable: true,
          enumerable: true,
          configurable: true
        });
        
        Object.defineProperty(optimizedParams, 'filename', {
          value: structuredParams.filename,
          writable: true,
          enumerable: true,
          configurable: true
        });
        
        Object.defineProperty(optimizedParams, 'mimeType', {
          value: structuredParams.mimeType,
          writable: true,
          enumerable: true,
          configurable: true
        });
        
        if (structuredParams.folder) {
          Object.defineProperty(optimizedParams, 'folder', {
            value: structuredParams.folder,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
        
        Object.defineProperty(optimizedParams, 'drive', {
          value: structuredParams.drive,
          writable: true,
          enumerable: true,
          configurable: true
        });
        
        devLog.verbose('📁 [DRIVE TRANSFORM] Prepared parameters:', {
          filename: structuredParams.filename,
          mimeType: structuredParams.mimeType,
          folder: structuredParams.folder,
          drive: structuredParams.drive,
          fileUrl: '[SUPABASE_URL]'
        });
        devLog.verbose('📁 [DRIVE TRANSFORM] Parameter order:', Object.keys(optimizedParams));
        
      } catch (error) {
        devLog.error('📁 [DRIVE TRANSFORM] Error preparing file upload:', error);
        throw new Error('Failed to prepare file for Google Drive upload');
      }
    }
  }

  console.log(`🔧 [TRANSFORM] Final transformation result for ${toolName}:`);
  console.log(`🔧 [TRANSFORM] Final params:`, JSON.stringify(optimizedParams, null, 2));
  console.log(`🔧 [TRANSFORM] Has file parameter:`, !!optimizedParams.file);
  console.log(`🔧 [TRANSFORM] Has files parameter:`, !!optimizedParams.files);
  console.log(`🔧 [TRANSFORM] Parameter keys:`, Object.keys(optimizedParams));

  return optimizedParams;
}

function analyzeEmailIntent(userMessage: string): { shouldSend: boolean; confidence: number; reasoningText: string } {
  const message = userMessage.toLowerCase();
  
  // Strong send indicators
  const sendKeywords = ['send', 'email', 'immediately', 'now', 'dispatch', 'transmit', 'deliver'];
  const strongSendPhrases = ['send an email', 'send email', 'email to', 'send and email'];
  
  // Draft indicators
  const draftKeywords = ['draft', 'prepare', 'create draft', 'make a draft', 'compose draft'];
  
  let sendScore = 0;
  let draftScore = 0;
  let reasoning = '';
  
  // Check for strong send phrases first (higher weight)
  for (const phrase of strongSendPhrases) {
    if (message.includes(phrase)) {
      sendScore += 3;
      reasoning += `Strong send phrase: "${phrase}". `;
      break; // Only count one strong phrase
    }
  }
  
  // Check for send keywords
  const sendMatches = sendKeywords.filter(keyword => message.includes(keyword));
  if (sendMatches.length > 0) {
    sendScore += sendMatches.length * 2;
    reasoning += `Send keywords: ${sendMatches.join(', ')}. `;
  }
  
  // Check for draft keywords
  const draftMatches = draftKeywords.filter(keyword => message.includes(keyword));
  if (draftMatches.length > 0) {
    draftScore += draftMatches.length * 2;
    reasoning += `Draft keywords: ${draftMatches.join(', ')}. `;
  }
  
  // Calculate confidence and decision
  const totalScore = sendScore + draftScore;
  const shouldSend = sendScore > draftScore;
  const confidence = totalScore > 0 ? Math.max(sendScore, draftScore) / (totalScore + 2) : 0.1;
  
  return {
    shouldSend,
    confidence: Math.min(confidence, 0.95), // Cap at 95%
    reasoningText: reasoning.trim() || 'No clear indicators found'
  };
}

function analyzeCalendarIntent(userMessage: string): { 
  operation: 'find' | 'create' | 'update' | 'delete'; 
  timeScope: 'today' | 'tomorrow' | 'week' | 'month' | 'next' | 'specific';
  confidence: number; 
  reasoningText: string 
} {
  const message = userMessage.toLowerCase();
  
  // Operation indicators
  const findKeywords = ['find', 'get', 'fetch', 'show', 'check', 'what', 'next', 'upcoming'];
  const createKeywords = ['create', 'add', 'schedule', 'book', 'make', 'set up'];
  const updateKeywords = ['update', 'edit', 'change', 'modify', 'reschedule'];
  const deleteKeywords = ['delete', 'remove', 'cancel', 'clear'];
  
  // Time scope indicators
  const todayKeywords = ['today', 'now', 'current'];
  const tomorrowKeywords = ['tomorrow', 'next day'];
  const weekKeywords = ['week', 'this week', 'next week'];
  const monthKeywords = ['month', 'this month', 'next month'];
  const nextKeywords = ['next', 'upcoming', 'future'];
  
  let findScore = 0;
  let createScore = 0;
  let updateScore = 0;
  let deleteScore = 0;
  let reasoning = '';
  
  // Check for operation keywords
  const findMatches = findKeywords.filter(keyword => message.includes(keyword));
  if (findMatches.length > 0) {
    findScore += findMatches.length * 2;
    reasoning += `Find keywords: ${findMatches.join(', ')}. `;
  }
  
  const createMatches = createKeywords.filter(keyword => message.includes(keyword));
  if (createMatches.length > 0) {
    createScore += createMatches.length * 2;
    reasoning += `Create keywords: ${createMatches.join(', ')}. `;
  }
  
  const updateMatches = updateKeywords.filter(keyword => message.includes(keyword));
  if (updateMatches.length > 0) {
    updateScore += updateMatches.length * 2;
    reasoning += `Update keywords: ${updateMatches.join(', ')}. `;
  }
  
  const deleteMatches = deleteKeywords.filter(keyword => message.includes(keyword));
  if (deleteMatches.length > 0) {
    deleteScore += deleteMatches.length * 2;
    reasoning += `Delete keywords: ${deleteMatches.join(', ')}. `;
  }
  
  // Determine operation
  const scores = { find: findScore, create: createScore, update: updateScore, delete: deleteScore };
  const operation = Object.keys(scores).reduce((a, b) => scores[a as keyof typeof scores] > scores[b as keyof typeof scores] ? a : b) as 'find' | 'create' | 'update' | 'delete';
  
  // Determine time scope
  let timeScope: 'today' | 'tomorrow' | 'week' | 'month' | 'next' | 'specific' = 'next';
  
  if (todayKeywords.some(keyword => message.includes(keyword))) {
    timeScope = 'today';
  } else if (tomorrowKeywords.some(keyword => message.includes(keyword))) {
    timeScope = 'tomorrow';
  } else if (weekKeywords.some(keyword => message.includes(keyword))) {
    timeScope = 'week';
  } else if (monthKeywords.some(keyword => message.includes(keyword))) {
    timeScope = 'month';
  } else if (nextKeywords.some(keyword => message.includes(keyword))) {
    timeScope = 'next';
  }
  
  // Calculate confidence
  const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const maxScore = Math.max(...Object.values(scores));
  const confidence = totalScore > 0 ? maxScore / (totalScore + 2) : 0.1;
  
  return {
    operation,
    timeScope,
    confidence: Math.min(confidence, 0.95),
    reasoningText: reasoning.trim() || 'No clear indicators found'
  };
}

// Define validation schema
const ApproveSchema = z.object({
  toolCallId: z.string(),
  action: z.enum(['approve', 'cancel']),
  sessionId: z.string().optional(), // Add sessionId for MCP tool persistence
  params: z.record(z.any()).optional() // Add params for custom approval parameters
});

export async function POST(req: NextRequest) {
  try {
    console.log('API APPROVE: Processing tool approval request');
    
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (jsonError) {
      console.error('API APPROVE: Failed to parse JSON body:', jsonError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
    
    console.log('API APPROVE: Received body:', JSON.stringify(body, null, 2));
    console.log('API APPROVE: Body type:', typeof body);
    console.log('API APPROVE: Body keys:', body ? Object.keys(body) : 'body is null/undefined');
    console.log('API APPROVE: toolCallId type:', typeof body?.toolCallId, 'value:', body?.toolCallId);
    console.log('API APPROVE: action type:', typeof body?.action, 'value:', body?.action);
    console.log('API APPROVE: sessionId type:', typeof body?.sessionId, 'value:', body?.sessionId);
    
    // Validate with Zod schema
    let parsedData;
    try {
      parsedData = ApproveSchema.parse(body);
    } catch (zodError) {
      console.error('API APPROVE: Zod validation error:', zodError);
      if (zodError instanceof z.ZodError) {
        console.error('API APPROVE: Zod error details:', JSON.stringify(zodError.errors, null, 2));
      }
      return NextResponse.json(
        { error: 'Invalid request format', details: zodError instanceof z.ZodError ? zodError.errors : String(zodError) },
        { status: 400 }
      );
    }
    
    const { toolCallId, action, sessionId, params = {} } = parsedData;
    
    console.log(`API APPROVE: Tool ${toolCallId}, action=${action}`);
    
    // Get access to the global toolApprovalState from the chat route
    const global = globalThis as any;
    
    // Make sure global state exists
    if (!global.toolApprovalState) {
      global.toolApprovalState = {};
      console.log('API APPROVE: Created empty toolApprovalState');
    } else {
      console.log('API APPROVE: Using existing toolApprovalState with keys:', Object.keys(global.toolApprovalState));
    }
    
    const toolApprovalState = global.toolApprovalState;
    const persistentMcpClient = global.persistentMcpClient;
    
    // Log MCP client status
    console.log('API APPROVE: MCP client availability:', !!persistentMcpClient);
    
    // Debug logging (removed file system logging due to errors)
    
    if (!toolApprovalState) {
      console.error('API APPROVE: No toolApprovalState found in global scope');
      return NextResponse.json(
        { error: 'Tool approval state not initialized' },
        { status: 500 }
      );
    }
    
    // Check persistent state first, create if not exists
    let persistentState = await ToolExecutionStateService.getByToolCallId(toolCallId);
    
    // 🔍 CRITICAL FIX: Always ensure persistent state has correct parameters from global state
    if (toolApprovalState[toolCallId]) {
      const toolCall = toolApprovalState[toolCallId]?.toolCall;
      
      // 🎯 CRITICAL DEBUG: Log before and after parameter transfer
      console.log(`[APPROVAL DEBUG] BEFORE - toolApprovalState[${toolCallId}]:`, toolApprovalState[toolCallId]);
      console.log(`[APPROVAL DEBUG] BEFORE - persistentState.tool_params:`, persistentState?.tool_params);
      
      if (!persistentState) {
        // Create persistent state with transformed parameters from global state
        console.log(`No persistent state found for ${toolCallId}, creating it with global state params...`);
        console.log(`Global state params:`, toolCall?.params);
        
        if (toolCall) {
          // 🖼️ CRITICAL: Retrieve attached images from global context and add to parameters
          const effectiveSessionId = sessionId || toolCall.meta?.sessionId || toolCallId;
          let paramsWithImages = { ...toolCall.params };
          
          console.log(`🔍 [CONTEXT DEBUG] Searching for image context with sessionId: ${effectiveSessionId}`);
          console.log(`🔍 [CONTEXT DEBUG] Available global context keys:`, (globalThis as any).mcpImageContext ? Object.keys((globalThis as any).mcpImageContext) : 'none');
          
          if ((globalThis as any).mcpImageContext && (globalThis as any).mcpImageContext[effectiveSessionId]) {
            const imageContext = (globalThis as any).mcpImageContext[effectiveSessionId];
            console.log(`🔍 [CONTEXT DEBUG] Found image context for session ${effectiveSessionId}:`, {
              hasAttachedImages: !!imageContext.attachedImages,
              attachedImagesCount: imageContext.attachedImages?.length || 0,
              hasDownloadableUrls: !!imageContext.downloadableUrls,
              downloadableUrlsCount: imageContext.downloadableUrls?.length || 0,
              hasImageUrl: !!imageContext.imageUrl,
              contextKeys: Object.keys(imageContext)
            });
            
            if (imageContext.attachedImages && imageContext.attachedImages.length > 0) {
              console.log(`🖼️ [IMAGE CONTEXT] Found ${imageContext.attachedImages.length} attached images for session ${effectiveSessionId}`);
              paramsWithImages = {
                ...paramsWithImages,
                attachedImages: imageContext.attachedImages,
                sessionId: effectiveSessionId
              };
            }
            
            // ✨ NEW: Also inject downloadableUrls directly for immediate access
            if (imageContext.downloadableUrls && imageContext.downloadableUrls.length > 0) {
              console.log(`🔗 [IMAGE CONTEXT] Found ${imageContext.downloadableUrls.length} downloadable URLs for session ${effectiveSessionId}`);
              paramsWithImages = {
                ...paramsWithImages,
                downloadableUrls: imageContext.downloadableUrls,
                sessionId: effectiveSessionId
              };
            }
          } else {
            console.log(`🔍 [CONTEXT DEBUG] No image context found for session ${effectiveSessionId}`);
          }
          
          // 🎯 CRITICAL FIX: Apply parameter transformation BEFORE storing
          const transformedParams = await transformToolParameters(toolCall.name, paramsWithImages);
          console.log(`🔍 [PARAM TRANSFORM] Pre-storage transformation for ${toolCall.name}:`);
          console.log(`🔍 [PARAM TRANSFORM]   Original:`, toolCall.params);
          console.log(`🔍 [PARAM TRANSFORM]   With Images:`, paramsWithImages);
          console.log(`🔍 [PARAM TRANSFORM]   Transformed:`, transformedParams);
          
          persistentState = await ToolExecutionStateService.create({
            chat_id: sessionId || '00000000-0000-0000-0000-000000000000', // Use sessionId if available
            message_id: Date.now(),
            tool_call_id: toolCallId,
            tool_name: toolCall.name || 'unknown_tool',
            tool_params: transformedParams
          });
          
          if (persistentState) {
            console.log(`Created persistent state for ${toolCallId}: ${persistentState.id}`);
            console.log(`Stored parameters:`, persistentState.tool_params);
          }
        }
      } else {
        // 🔍 CRITICAL: Update existing persistent state with transformed parameters from global state
        // This handles the case where frontend created persistent state with empty parameters
        const globalParams = toolCall?.params || {};
        const currentParams = persistentState.tool_params || {};
        
        // 🖼️ CRITICAL: Retrieve attached images from global context and add to parameters
        const effectiveSessionId = sessionId || toolCall.meta?.sessionId || toolCallId;
        let globalParamsWithImages = { ...globalParams };
        
        console.log(`🔍 [CONTEXT DEBUG] Update: Searching for image context with sessionId: ${effectiveSessionId}`);
        console.log(`🔍 [CONTEXT DEBUG] Update: Available global context keys:`, (globalThis as any).mcpImageContext ? Object.keys((globalThis as any).mcpImageContext) : 'none');
        
        if ((globalThis as any).mcpImageContext && (globalThis as any).mcpImageContext[effectiveSessionId]) {
          const imageContext = (globalThis as any).mcpImageContext[effectiveSessionId];
          console.log(`🔍 [CONTEXT DEBUG] Update: Found image context for session ${effectiveSessionId}:`, {
            hasAttachedImages: !!imageContext.attachedImages,
            attachedImagesCount: imageContext.attachedImages?.length || 0,
            hasDownloadableUrls: !!imageContext.downloadableUrls,
            downloadableUrlsCount: imageContext.downloadableUrls?.length || 0,
            hasImageUrl: !!imageContext.imageUrl,
            contextKeys: Object.keys(imageContext)
          });
          
          if (imageContext.attachedImages && imageContext.attachedImages.length > 0) {
            console.log(`🖼️ [IMAGE CONTEXT] Found ${imageContext.attachedImages.length} attached images for update`);
            globalParamsWithImages = {
              ...globalParamsWithImages,
              attachedImages: imageContext.attachedImages,
              sessionId: effectiveSessionId
            };
          }
          
          // ✨ NEW: Also inject downloadableUrls directly for immediate access
          if (imageContext.downloadableUrls && imageContext.downloadableUrls.length > 0) {
            console.log(`🔗 [IMAGE CONTEXT] Found ${imageContext.downloadableUrls.length} downloadable URLs for update`);
            globalParamsWithImages = {
              ...globalParamsWithImages,
              downloadableUrls: imageContext.downloadableUrls,
              sessionId: effectiveSessionId
            };
          }
        } else {
          console.log(`🔍 [CONTEXT DEBUG] Update: No image context found for session ${effectiveSessionId}`);
        }
        
        // 🎯 CRITICAL FIX: Apply transformation to global params before comparison
        const transformedGlobalParams = await transformToolParameters(toolCall.name, globalParamsWithImages);
        
        // Only update if transformed global state has more parameters than persistent state
        if (Object.keys(transformedGlobalParams).length > Object.keys(currentParams).length) {
          console.log(`Updating persistent state ${toolCallId} with transformed global state params:`, transformedGlobalParams);
          
          persistentState = await ToolExecutionStateService.update(toolCallId, {
            tool_params: transformedGlobalParams
          });
          
          if (persistentState) {
            console.log(`Updated persistent state with transformed global parameters`);
            console.log(`Updated parameters:`, persistentState.tool_params);
          }
        } else {
          console.log(`Persistent state already has sufficient parameters:`, currentParams);
        }
      }
      
      // 🎯 CRITICAL DEBUG: Log after parameter transfer
      console.log(`[APPROVAL DEBUG] AFTER - Updated persistent state:`, persistentState);
      console.log(`[APPROVAL DEBUG] AFTER - Final tool_params:`, persistentState?.tool_params);
    }
    
    if (!toolApprovalState[toolCallId] && !persistentState) {
      console.error(`API APPROVE: Tool call ID not found: ${toolCallId}`);
      return NextResponse.json(
        { error: 'Tool call not found or already processed' },
        { status: 404 }
      );
    }
    
    // Check if tool is already completed
    if (persistentState && ['completed', 'error', 'cancelled'].includes(persistentState.status)) {
      console.log(`API APPROVE: Tool ${toolCallId} already processed with status: ${persistentState.status}`);
      return NextResponse.json(
        { error: 'Tool call already processed', status: persistentState.status },
        { status: 409 }
      );
    }
    
    // Update approval state
    toolApprovalState[toolCallId].approved = action === 'approve';
    console.log(`API APPROVE: Updated approval state for ${toolCallId} to ${action === 'approve'}`);
    
    // Execute the tool if approved
    if (action === 'approve') {
      const toolCall = toolApprovalState[toolCallId]?.toolCall;
      
      if (!toolCall) {
        console.error(`API APPROVE: Tool call data missing for ID: ${toolCallId}`);
        return NextResponse.json(
          { error: 'Invalid tool call data' },
          { status: 400 }
        );
      }
      console.log(`API APPROVE: Executing approved tool: ${toolCall.name}`);
      
      // Use sessionId if provided, otherwise use placeholder UUID
      const effectiveChatId = sessionId || '00000000-0000-0000-0000-000000000000';
      
      // Update persistent state to approved and running - use upsert to handle missing states
      const storedToolCall = toolApprovalState[toolCallId]?.toolCall;
      if (storedToolCall) {
        // 🖼️ CRITICAL: Retrieve attached images from global context and add to parameters
        const effectiveSessionId = sessionId || storedToolCall.meta?.sessionId || toolCallId;
        let storedParamsWithImages = { ...storedToolCall.params };
        
        console.log(`🔍 [CONTEXT DEBUG] Execute: Searching for image context with sessionId: ${effectiveSessionId}`);
        console.log(`🔍 [CONTEXT DEBUG] Execute: Available global context keys:`, (globalThis as any).mcpImageContext ? Object.keys((globalThis as any).mcpImageContext) : 'none');
        
        if ((globalThis as any).mcpImageContext && (globalThis as any).mcpImageContext[effectiveSessionId]) {
          const imageContext = (globalThis as any).mcpImageContext[effectiveSessionId];
          console.log(`🔍 [CONTEXT DEBUG] Execute: Found image context for session ${effectiveSessionId}:`, {
            hasAttachedImages: !!imageContext.attachedImages,
            attachedImagesCount: imageContext.attachedImages?.length || 0,
            hasDownloadableUrls: !!imageContext.downloadableUrls,
            downloadableUrlsCount: imageContext.downloadableUrls?.length || 0,
            hasImageUrl: !!imageContext.imageUrl,
            contextKeys: Object.keys(imageContext)
          });
          
          if (imageContext.attachedImages && imageContext.attachedImages.length > 0) {
            console.log(`🖼️ [IMAGE CONTEXT] Found ${imageContext.attachedImages.length} attached images for execution`);
            storedParamsWithImages = {
              ...storedParamsWithImages,
              attachedImages: imageContext.attachedImages,
              sessionId: effectiveSessionId
            };
          }
          
          // ✨ NEW: Also inject downloadableUrls directly for immediate access
          if (imageContext.downloadableUrls && imageContext.downloadableUrls.length > 0) {
            console.log(`🔗 [IMAGE CONTEXT] Found ${imageContext.downloadableUrls.length} downloadable URLs for execution`);
            storedParamsWithImages = {
              ...storedParamsWithImages,
              downloadableUrls: imageContext.downloadableUrls,
              sessionId: effectiveSessionId
            };
          }
        } else {
          console.log(`🔍 [CONTEXT DEBUG] Execute: No image context found for session ${effectiveSessionId}`);
        }
        
        // 🎯 CRITICAL FIX: Apply parameter transformation for upsert operations
        console.log(`🔍 [TRANSFORM DEBUG] Before transformation for ${storedToolCall.name}:`);
        console.log(`🔍 [TRANSFORM DEBUG] Input params:`, JSON.stringify(storedParamsWithImages, null, 2));
        
        const transformedParams = await transformToolParameters(storedToolCall.name, storedParamsWithImages);
        
        console.log(`🔍 [TRANSFORM DEBUG] After transformation for ${storedToolCall.name}:`);
        console.log(`🔍 [TRANSFORM DEBUG] Output params:`, JSON.stringify(transformedParams, null, 2));
        console.log(`🔍 [TRANSFORM DEBUG] Has 'file' parameter:`, !!transformedParams.file);
        console.log(`🔍 [TRANSFORM DEBUG] Has 'files' parameter:`, !!transformedParams.files);
        
        await ToolExecutionStateService.upsert({
          chat_id: effectiveChatId,
          message_id: Date.now(),
          tool_call_id: toolCallId,
          tool_name: storedToolCall.name,
          tool_params: transformedParams,
          status: 'approved'
        });
        await ToolExecutionStateService.upsert({
          chat_id: effectiveChatId,
          message_id: Date.now(),
          tool_call_id: toolCallId,
          tool_name: storedToolCall.name,
          tool_params: transformedParams,
          status: 'running'
        });
      }
      
      // Declare variables at the top of the try block
      const allMcpTools: Record<string, any> = {};
      let activeClient = null;
      let cachedTools: any[] = [];
      
      try {
        console.log(`API APPROVE: About to execute tool with name=${toolCall.name} and params:`, toolCall.params);
        
        // 🔍 CRITICAL DEBUG: Check if we reach this point at all
        console.log('🔍 [CRITICAL DEBUG] Execution flow reached - checking tool type...');
        // Don't log these until after they're populated
        // console.log('🔍 [DEBUG] allMcpTools keys:', Object.keys(allMcpTools || {}));
        // console.log('🔍 [DEBUG] cachedTools length:', cachedTools.length);
        // console.log('🔍 [DEBUG] activeClient exists:', !!activeClient);
        
        // Gmail vs Calendar execution tracking
        if (toolCall.name.includes('gmail')) {
          devLog.verbose('🔍 [GMAIL EXECUTION] Starting Gmail tool execution...');
          devLog.verbose('🔍 [GMAIL EXECUTION] Tool name:', toolCall.name);
          devLog.verbose('🔍 [GMAIL EXECUTION] Params:', JSON.stringify(toolCall.params, null, 2));
          
          // Test if our redirection logic section is reached
          console.log('🔍 [GMAIL EXECUTION] About to enter Gmail optimization block...');
        }
        
        if (toolCall.name.includes('calendar')) {
          console.log('📅 [CALENDAR EXECUTION] Starting Calendar tool execution...');
          console.log('📅 [CALENDAR EXECUTION] Tool name:', toolCall.name);
          console.log('📅 [CALENDAR EXECUTION] Params:', JSON.stringify(toolCall.params, null, 2));
        }
        
        // Log MCP client details to understand available methods
        if (persistentMcpClient) {
          console.log('API APPROVE: MCP client methods:', 
            Object.getOwnPropertyNames(Object.getPrototypeOf(persistentMcpClient)));
        } else {
          console.log('API APPROVE: persistentMcpClient is null/undefined');
        }
        
        // Log out what we're executing
        console.log('API APPROVE: Executing tool call with:', {
          toolName: toolCall.name,
          params: toolCall.params,
          metadata: toolCall.meta,
          client: typeof persistentMcpClient
        });
        
        // 🔧 FIXED: Use cached tools from production router to avoid rediscovery
        console.log('API APPROVE: Using cached tools from production router...');
        
        // Get the chat ID/session ID from the request or use a fallback
        // Prefer the sessionId from toolCall metadata for consistency
        const metaSessionId = toolCall.meta?.sessionId;
        const chatId = metaSessionId || sessionId || toolCall.meta?.chatId || persistentState?.chat_id || '00000000-0000-0000-0000-000000000000';
        
        console.log(`API APPROVE: Session ID debug:`);
        console.log(`  - sessionId from metadata: ${metaSessionId || 'none'}`);
        console.log(`  - sessionId from request: ${sessionId || 'none'}`);
        console.log(`  - toolCall.meta?.chatId: ${toolCall.meta?.chatId || 'none'}`);
        console.log(`  - persistentState?.chat_id: ${persistentState?.chat_id || 'none'}`);
        console.log(`  - Final chatId being used: ${chatId}`);
        
        // Use production router to get cached tools
        const { productionMcpRouter } = await import('@/lib/mcp/production-router');
        const servers = await productionMcpRouter.getAvailableServers();
        
        console.log(`API APPROVE: Getting cached tools with chatId: ${chatId}`);
        
        // First check local global cache
        console.log(`API APPROVE: Global cache keys: ${Array.from(global_cache.mcpToolsCache.keys()).join(', ')}`);
        console.log(`API APPROVE: Global cache size: ${global_cache.mcpToolsCache.size}`);
        
        const localCache = global_cache.mcpToolsCache.get(chatId);
        if (localCache && Date.now() - localCache.timestamp < 15 * 60 * 1000) {
          console.log(`API APPROVE: Found tools in local global cache for ${chatId}: ${localCache.tools.length} tools`);
          console.log(`API APPROVE: Tool names from cache: ${localCache.tools.map((t: any) => t.name).join(', ')}`);
          cachedTools = localCache.tools;
        } else {
          console.log(`API APPROVE: No tools in local global cache for ${chatId}, trying production router`);
          // Try production router cache
          cachedTools = await productionMcpRouter.getCachedTools(servers, chatId);
          console.log(`API APPROVE: Production router returned ${cachedTools.length} tools for session ${chatId}`);
        }
        
        // If we have cached tools, use them directly
        if (cachedTools.length > 0) {
          console.log('API APPROVE: Using cached tools, skipping discovery');
          console.log(`API APPROVE: Cached tool names: ${cachedTools.map(t => t.name).join(', ')}`);
          
          // Convert cached tools to the format expected by the execution logic
          for (const cachedTool of cachedTools) {
            allMcpTools[cachedTool.name] = cachedTool;
          }
          
          // Use the Universal MCP Client for execution
          const { UniversalMcpClient } = await import('@/lib/mcp/universal-client');
          activeClient = UniversalMcpClient.getInstance();
        } else {
          console.log('API APPROVE: No cached tools found, falling back to discovery');
          
          // Fall back to original discovery if no cached tools
          const { discoverAllMcpServers } = await import('@/lib/mcp/discovery');
          const endpoints = await discoverAllMcpServers();
          
          console.log(`API APPROVE: Connecting to ${endpoints.length} MCP servers:`, endpoints.map(e => e.name));
          
          // Connect to each server and aggregate tools (EXACT same as chat API)
          for (const endpoint of endpoints) {
          try {
            console.log(`API APPROVE: Connecting to ${endpoint.name} at ${endpoint.url}...`);
            
            let client: any;
            
            // Use different transport based on endpoint type
            if (endpoint.name === 'Zapier' || endpoint.type === 'http') {
              // Import MCP SDK for Zapier
              const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
              const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
              
              console.log(`API APPROVE: Using HTTP transport for ${endpoint.name}`);
              
              const mcpClient = new Client(
                {
                  name: "chatrag-mcp-client",
                  version: "1.0.0",
                },
                {
                  capabilities: {},
                }
              );
              
              const transport = new StreamableHTTPClientTransport(new URL(endpoint.url));
              await mcpClient.connect(transport);
              
              // Create a wrapper that matches the AI SDK client interface
              client = {
                tools: async () => {
                  const toolsResponse = await mcpClient.listTools();
                  const tools: Record<string, any> = {};
                  if (toolsResponse.tools) {
                    for (const tool of toolsResponse.tools) {
                      tools[tool.name] = {
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        execute: async (params: any) => {
                          return await mcpClient.callTool({
                            name: tool.name,
                            arguments: params
                          });
                        }
                      };
                    }
                  }
                  return tools;
                }
              };
            } else {
              // Use SSE transport for other endpoints
              console.log(`API APPROVE: Using SSE transport for ${endpoint.name}`);
              
              // Import MCP SDK for SSE
              const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
              const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
              
              const mcpClient = new Client(
                {
                  name: "chatrag-mcp-client",
                  version: "1.0.0",
                },
                {
                  capabilities: {},
                }
              );
              
              const transport = new SSEClientTransport(new URL(endpoint.url), {
                headers: { 'Content-Type': 'application/json' }
              });
              await mcpClient.connect(transport);
              
              // Create a wrapper that matches the AI SDK client interface
              client = {
                tools: async () => {
                  const toolsResponse = await mcpClient.listTools();
                  const tools: Record<string, any> = {};
                  if (toolsResponse.tools) {
                    for (const tool of toolsResponse.tools) {
                      tools[tool.name] = {
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        execute: async (params: any) => {
                          return await mcpClient.callTool({
                            name: tool.name,
                            arguments: params
                          });
                        }
                      };
                    }
                  }
                  return tools;
                }
              };
            }
            
            const serverTools = await client.tools();
            const toolCount = Object.keys(serverTools).length;
            console.log(`API APPROVE: Retrieved ${toolCount} tools from ${endpoint.name}`);
            
            // Add tools to aggregated collection (same as chat API)
            Object.entries(serverTools).forEach(([toolName, tool]) => {
              allMcpTools[toolName] = tool;
              
              // If this is the tool we're looking for, save the client
              if (toolName === toolCall.name) {
                activeClient = client;
                console.log(`API APPROVE: Found target tool ${toolName} on ${endpoint.name} server`);
              }
            });
            
          } catch (error) {
            console.error(`API APPROVE: Failed to connect to ${endpoint.name}:`, error);
            // Continue with other servers instead of failing completely
          }
        }
        } // End of else block for fallback discovery
        
        console.log(`API APPROVE: Aggregated ${Object.keys(allMcpTools).length} total tools from all servers`);
        console.log(`API APPROVE: Available tools:`, Object.keys(allMcpTools));
        
        // Check if the requested tool exists in any server
        if (!allMcpTools[toolCall.name]) {
          console.error(`API APPROVE: Tool ${toolCall.name} not found in any MCP server. Available tools:`, 
            Object.keys(allMcpTools));
          throw new Error(`Tool ${toolCall.name} not available in any MCP server`);
        }
        
        if (!activeClient && cachedTools.length === 0) {
          console.error(`API APPROVE: No active client found for tool ${toolCall.name}`);
          throw new Error(`No active MCP client found for tool ${toolCall.name}`);
        }
        
        console.log(`API APPROVE: Using ${cachedTools.length > 0 ? 'cached' : 'active'} client for tool execution: ${toolCall.name}`);
        const mcpTools = allMcpTools;
        
        // Execute the tool using the execute method on the tool itself
        let result;
        if (toolCall.name.includes('gmail')) {
          devLog.verbose('🔍 [GMAIL] Processing with optimized Zapier instructions parameter');
          
          // ENHANCED GMAIL PROCESSING: Handle data chaining between tools
          // CRITICAL FIX: Use structured parameters from persistent state instead of raw params
          const optimizedParams = persistentState?.tool_params && Object.keys(persistentState.tool_params).length > 0 
            ? { ...persistentState.tool_params }
            : { ...toolCall.params };
          
          console.log('🔍 [GMAIL CACHE STATUS] At Gmail tool execution:', {
            toolName: toolCall.name,
            hasGlobalCache: !!global_cache,
            hasGmailCache: !!global_cache?.gmailCache,
            hasLastFoundEmail: !!global_cache?.gmailCache?.lastFoundEmail,
            lastFoundEmailStructure: global_cache?.gmailCache?.lastFoundEmail ? {
              type: typeof global_cache.gmailCache.lastFoundEmail,
              keys: Object.keys(global_cache.gmailCache.lastFoundEmail),
              hasContent: !!global_cache.gmailCache.lastFoundEmail.content,
              contentLength: global_cache.gmailCache.lastFoundEmail.content?.length || 0
            } : null,
            recentEmailsCount: global_cache?.gmailCache?.recentEmails?.length || 0,
            cacheAge: global_cache?.gmailCache?.timestamp ? `${Date.now() - global_cache.gmailCache.timestamp}ms` : 'N/A'
          });
          
          // Pass user message for email extraction
          const userMessage = (toolCall.params?.instructions as string) || (body.messages?.[body.messages.length - 1]?.content as string) || '';
          optimizedParams._userMessage = userMessage;
          
          // 🎯 CRITICAL FIX: Transform instructions → query for Gmail find_email tools
          // The Zapier MCP client expects 'query' parameter, but AI sends 'instructions'
          if (toolCall.name.includes('find_email') && optimizedParams.instructions && !optimizedParams.query) {
            devLog.verbose('🔍 [PARAM TRANSFORM] Converting instructions to query parameter for Gmail find_email');
            devLog.verbose('🔍 [PARAM TRANSFORM] Original instructions:', optimizedParams.instructions);
            
            // Transform instructions to Gmail search query
            let searchQuery = optimizedParams.instructions;
            
            // Add default search scope if not specified
            if (!searchQuery.includes('in:') && !searchQuery.includes('from:') && !searchQuery.includes('subject:')) {
              // For general queries like "find my recent emails", add in:inbox
              if (searchQuery.toLowerCase().includes('recent') || searchQuery.toLowerCase().includes('latest') || searchQuery.toLowerCase().includes('last')) {
                searchQuery = 'in:inbox';
              }
            }
            
            optimizedParams.query = searchQuery;
            devLog.verbose('🔍 [PARAM TRANSFORM] Transformed query:', optimizedParams.query);
            devLog.verbose('🔍 [PARAM TRANSFORM] Final parameter count:', Object.keys(optimizedParams).length);
          }

          // 🔄 GMAIL SMART TOOL REDIRECTION: Fix draft vs send selection
          // This logic runs BEFORE the existing Gmail optimization
          if (toolCall.name === 'gmail_create_draft') {
            // Extract user message from tool call instructions or a fallback
            const userMessage = (toolCall.params?.instructions as string) || (body.messages?.[body.messages.length - 1]?.content as string) || '';
            const intentScore = analyzeEmailIntent(userMessage);
            
            console.log(`🔄 [GMAIL REDIRECTION] Analyzing intent for draft call. User message: "${userMessage}"`);
            console.log(`🔄 [GMAIL REDIRECTION] Intent analysis: ${JSON.stringify(intentScore)}`);
            
            // Redirect to send if user clearly intended to send (not draft)
            if (intentScore.shouldSend && intentScore.confidence >= 0.7) {
              console.log(`🔄 [GMAIL REDIRECTION] HIGH CONFIDENCE SEND INTENT (${intentScore.confidence.toFixed(2)}). Redirecting gmail_create_draft → gmail_send_email`);
              
              // 🔧 ATTACHMENT PARAMETER PRESERVATION: Ensure attachment parameters are preserved during redirection
              const originalParams = { ...optimizedParams };
              console.log('🔄 [GMAIL REDIRECTION] Original parameters before redirection:', JSON.stringify(originalParams, null, 2));
              
              // Preserve attachment-related parameters
              const attachmentParams = {
                file: originalParams.file,
                attachment_url: originalParams.attachment_url,
                files: originalParams.files,
                file_url: originalParams.file_url,
                file_urls: originalParams.file_urls
              };
              
              // Only include attachment parameters that actually exist
              const preservedAttachmentParams = Object.fromEntries(
                Object.entries(attachmentParams).filter(([_, value]) => value !== undefined && value !== null)
              );
              
              if (Object.keys(preservedAttachmentParams).length > 0) {
                console.log('🔄 [GMAIL REDIRECTION] Preserving attachment parameters:', JSON.stringify(preservedAttachmentParams, null, 2));
                
                // Merge preserved attachment parameters back into optimizedParams
                Object.assign(optimizedParams, preservedAttachmentParams);
              }
              
              toolCall.name = 'gmail_send_email';
              
              console.log('🔄 [GMAIL REDIRECTION] Tool successfully redirected to gmail_send_email');
              console.log('🔄 [GMAIL REDIRECTION] Final parameters after redirection:', JSON.stringify(optimizedParams, null, 2));
            } else {
              console.log(`🔄 [GMAIL REDIRECTION] Keeping as draft. Reason: ${intentScore.shouldSend ? 'Low confidence' : 'Draft intent detected'} (confidence: ${intentScore.confidence.toFixed(2)})`);
            }
          }
          
          // Add comprehensive logging from GMAIL_FIX_PLAN.md Step 1
          devLog.verbose('🔍 [OPTIMIZATION START] Tool details:', {
            name: toolCall.name,
            hasReplyInName: toolCall.name.includes('reply_to_email'),
            hasDraftInName: toolCall.name.includes('create_draft_reply'),
            params: Object.keys(optimizedParams),
            cacheExists: !!global_cache?.gmailCache?.lastFoundEmail
          });

          // Verify tool name matching (from GMAIL_FIX_PLAN.MD Phase 1, Step 2)
          devLog.verbose('🔍 [DEBUG] Tool name being processed:', toolCall.name);
          devLog.verbose('🔍 [DEBUG] Checking conditions:', {
            includesReply: toolCall.name.includes('reply_to_email'),
            includesDraft: toolCall.name.includes('create_draft_reply')
          });
            
          // Test email extraction function directly (from GMAIL_FIX_PLAN.MD Phase 1, Step 3)
          // Assuming extractEmailAddressFromSender is defined elsewhere or will be defined
          // For now, let's define a placeholder if it's not present, or ensure it's correctly scoped
          // Enhanced version from GMAIL_FIX_PLAN.md Step 2:
          function extractEmailAddressFromSender(fromField: string): string | null {
            devLog.verbose('🔍 [EMAIL EXTRACT] Input:', fromField);
            
            if (!fromField) {
              devLog.verbose('🔍 [EMAIL EXTRACT] No fromField provided');
              return null;
            }

            // Try multiple patterns
            const patterns = [
              /<([^>]+)>/, // "Name <email@domain.com>"
              /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/, // Direct email
              /"?([^"]*)"?\s*<([^>]+)>/ // "Name" <email>
            ];

            for (const pattern of patterns) {
              const match = fromField.match(pattern);
              if (match) {
                const email = match[1] || match[2];
                devLog.verbose('🔍 [EMAIL EXTRACT] Success:', email, 'using pattern:', pattern);
                return email;
              }
            }

            devLog.verbose('🔍 [EMAIL EXTRACT] Failed - no patterns matched');
            return null;
          }

          const testEmail = "Carlos Marcial <carlos@example.com>";
          const extracted = extractEmailAddressFromSender(testEmail);
          devLog.verbose('🔍 [EMAIL TEST]', { input: testEmail, output: extracted });
          
          if (
            (toolCall.name.includes('reply_to_email') ||
              toolCall.name.includes('create_draft_reply'))
          ) {
            // Look for the best matching email from cache
            let cachedEmailData = null;
            const recentEmails = global_cache?.gmailCache?.recentEmails || [];

            // PRIORITY 1: Check if AI provided an email_id or message_id parameter
            const providedEmailId = optimizedParams.email_id || optimizedParams.message_id || optimizedParams.id;
            if (providedEmailId) {
              console.log(`🔍 [GMAIL REPLY/DRAFT] AI provided email_id: ${providedEmailId}, searching in cache...`);

              // Search in recent emails cache
              for (const recentEmail of recentEmails) {
                if (recentEmail.id === providedEmailId ||
                    recentEmail.messageId === providedEmailId ||
                    recentEmail.message_id === providedEmailId) {
                  // Convert cached email format to expected format
                  cachedEmailData = {
                    content: [{
                      text: JSON.stringify({
                        execution: {
                          result: [{
                            id: recentEmail.id || recentEmail.messageId || recentEmail.message_id,
                            threadId: recentEmail.threadId || recentEmail.thread_id,
                            from: recentEmail.from,
                            subject: recentEmail.subject
                          }]
                        },
                        results: [{
                          id: recentEmail.id || recentEmail.messageId || recentEmail.message_id,
                          threadId: recentEmail.threadId || recentEmail.thread_id,
                          from: recentEmail.from,
                          subject: recentEmail.subject
                        }]
                      })
                    }]
                  };
                  console.log(`🔍 [GMAIL REPLY/DRAFT] ✅ Found exact email match for ID: ${providedEmailId}`);
                  console.log(`🔍 [GMAIL REPLY/DRAFT] Email subject: "${recentEmail.subject}"`);
                  break;
                }
              }

              // Also check lastFoundEmail if it matches the ID
              if (!cachedEmailData && global_cache?.gmailCache?.lastFoundEmail) {
                try {
                  const lastFoundContent = JSON.parse(global_cache.gmailCache.lastFoundEmail.content[0].text);
                  const lastFoundResult = lastFoundContent.execution?.result?.[0] || lastFoundContent.results?.[0];
                  if (lastFoundResult && (lastFoundResult.id === providedEmailId ||
                      lastFoundResult.messageId === providedEmailId)) {
                    cachedEmailData = global_cache.gmailCache.lastFoundEmail;
                    console.log(`🔍 [GMAIL REPLY/DRAFT] ✅ Found email in lastFoundEmail cache for ID: ${providedEmailId}`);
                  }
                } catch (e) {
                  console.log(`🔍 [GMAIL REPLY/DRAFT] Could not parse lastFoundEmail cache`);
                }
              }

              if (!cachedEmailData) {
                console.log(`🔍 [GMAIL REPLY/DRAFT] ⚠️ Email ID ${providedEmailId} not found in cache, will proceed with fallback`);
              }
            }

            // PRIORITY 2: Check if user mentioned a specific sender in the parameters (only if no email_id match)
            if (!cachedEmailData) {
              const paramsStr = JSON.stringify(toolCall.params).toLowerCase();

              // Try to match by sender name mentioned in params
              for (const recentEmail of recentEmails) {
                if (recentEmail.from) {
                  // Handle from as either string or object
                  const senderString = typeof recentEmail.from === 'string'
                    ? recentEmail.from
                    : recentEmail.from.email || recentEmail.from.name || '';
                  const senderName = senderString.toLowerCase();
                  // Extract first name or key part of sender
                  const senderParts = senderName.split(/[\s<@]/);
                  for (const part of senderParts) {
                    if (part.length > 2 && paramsStr.includes(part)) {
                      // Convert cached email format to expected format
                      cachedEmailData = {
                        content: [{
                          text: JSON.stringify({
                            execution: {
                              result: [{
                                id: recentEmail.id || recentEmail.messageId || recentEmail.message_id,
                                threadId: recentEmail.threadId || recentEmail.thread_id,
                                from: recentEmail.from,
                                subject: recentEmail.subject
                              }]
                            },
                            results: [{
                              id: recentEmail.id || recentEmail.messageId || recentEmail.message_id,
                              threadId: recentEmail.threadId || recentEmail.thread_id,
                              from: recentEmail.from,
                              subject: recentEmail.subject
                            }]
                          })
                        }]
                      };
                      console.log(`🔍 [GMAIL REPLY/DRAFT] Found email by sender name match: ${recentEmail.from}`);
                      console.log(`🔍 [GMAIL REPLY/DRAFT] Email subject: "${recentEmail.subject}"`);
                      break;
                    }
                  }
                  if (cachedEmailData) break;
                }
              }
            }

            // PRIORITY 3: Fall back to lastFoundEmail if no specific match
            if (!cachedEmailData && global_cache?.gmailCache?.lastFoundEmail) {
              cachedEmailData = global_cache.gmailCache.lastFoundEmail;
              devLog.verbose('🔍 [GMAIL REPLY/DRAFT] Using lastFoundEmail as fallback');
              console.log('🔍 [GMAIL REPLY/DRAFT] lastFoundEmail structure:', {
                type: typeof cachedEmailData,
                keys: cachedEmailData ? Object.keys(cachedEmailData) : [],
                hasContent: !!cachedEmailData?.content,
                contentLength: cachedEmailData?.content?.length || 0
              });
            } else if (!cachedEmailData) {
              console.log('🔍 [GMAIL REPLY/DRAFT] No cached email data available:', {
                hasGlobalCache: !!global_cache,
                hasGmailCache: !!global_cache?.gmailCache,
                hasLastFoundEmail: !!global_cache?.gmailCache?.lastFoundEmail,
                recentEmailsCount: global_cache?.gmailCache?.recentEmails?.length || 0
              });
            }
            
            if (cachedEmailData) {
              devLog.verbose('🔍 [GMAIL REPLY/DRAFT] Attempting to use cached email data for auto-population.');
              
              // Debug cache structure
              console.log('🔍 [GMAIL REPLY/DRAFT] Cache structure validation:', {
                hasCachedData: !!cachedEmailData,
                hasContent: !!cachedEmailData?.content,
                contentIsArray: Array.isArray(cachedEmailData?.content),
                contentLength: cachedEmailData?.content?.length || 0,
                hasFirstContent: !!cachedEmailData?.content?.[0],
                hasText: !!cachedEmailData?.content?.[0]?.text,
                textType: typeof cachedEmailData?.content?.[0]?.text
              });

            let parsedText = null;
            if (cachedEmailData?.content?.[0]?.text) {
              try {
                console.log('🔍 [GMAIL REPLY/DRAFT] Attempting to parse cached text (first 200 chars):', cachedEmailData.content[0].text.substring(0, 200));
                parsedText = JSON.parse(cachedEmailData.content[0].text);
              } catch (e) {
                console.error('🔍 [GMAIL REPLY/DRAFT] Error parsing cached email content:', e);
                console.log('🔍 [GMAIL REPLY/DRAFT] Invalid JSON text:', cachedEmailData.content[0].text);
                // parsedText will remain null
              }
            } else {
              console.log('🔍 [GMAIL REPLY/DRAFT] No text content found in cached email data structure');
            }

            if (parsedText) {
              devLog.verbose('🔍 [GMAIL REPLY/DRAFT] Successfully parsed cached text content.');
              const primaryEmailDataSource = parsedText.execution?.result?.[0]; // Preferred for threadId and as fallback
              const secondaryEmailDataSource = parsedText.results?.[0];       // Preferred for from/subject

              if (primaryEmailDataSource) {
                  devLog.verbose("🔍 [GMAIL REPLY/DRAFT] Primary email data source (execution.result[0]):", JSON.stringify(primaryEmailDataSource, null, 2));
              }
              if (secondaryEmailDataSource) {
                  devLog.verbose("🔍 [GMAIL REPLY/DRAFT] Secondary email data source (results[0]):", JSON.stringify(secondaryEmailDataSource, null, 2));
              }

              // Determine 'to' address
              const fromDetails = secondaryEmailDataSource?.from || primaryEmailDataSource?.from;
              if (fromDetails) {
                const senderEmail = extractEmailAddressFromSender(typeof fromDetails === 'string' ? fromDetails : fromDetails.email || fromDetails.name);
                            if (senderEmail) {
                              optimizedParams.to = senderEmail;
                  devLog.verbose(`🔍 [GMAIL REPLY/DRAFT] Auto-populated TO field: ${senderEmail}`);
                            } else {
                  devLog.verbose('🔍 [GMAIL REPLY/DRAFT] Could not extract sender email from:', JSON.stringify(fromDetails, null, 2));
                }
              } else {
                console.log('🔍 [GMAIL REPLY/DRAFT] No "from" details found in cached email to set "to" field.');
                            }

              // Determine 'thread_id' - UNCONDITIONALLY OVERWRITE/SET from cache if available
              // Check for both camelCase and snake_case versions, but DO NOT fall back to message ID
              const threadIdFromCache = primaryEmailDataSource?.threadId || primaryEmailDataSource?.thread_id || 
                                       secondaryEmailDataSource?.threadId || secondaryEmailDataSource?.thread_id;
              
              // Log what we found for debugging
              console.log('🔍 [GMAIL REPLY/DRAFT] Thread ID extraction:', {
                primaryThreadId: primaryEmailDataSource?.threadId,
                primaryThread_id: primaryEmailDataSource?.thread_id,
                primaryId: primaryEmailDataSource?.id,
                secondaryThreadId: secondaryEmailDataSource?.threadId,
                secondaryThread_id: secondaryEmailDataSource?.thread_id,
                secondaryId: secondaryEmailDataSource?.id,
                selectedThreadId: threadIdFromCache
              });
              if (threadIdFromCache) {
                if (optimizedParams.thread_id && optimizedParams.thread_id !== threadIdFromCache) {
                  console.log(`🔍 [GMAIL REPLY/DRAFT] Overwriting AI-provided thread_id "${optimizedParams.thread_id}" with cached thread_id "${threadIdFromCache}".`);
                } else if (!optimizedParams.thread_id) {
                  console.log(`🔍 [GMAIL REPLY/DRAFT] Setting thread_id from cache: "${threadIdFromCache}".`);
                } else {
                  console.log(`🔍 [GMAIL REPLY/DRAFT] AI-provided thread_id "${optimizedParams.thread_id}" matches cached_id "${threadIdFromCache}". No change needed.`);
                }
                optimizedParams.thread_id = threadIdFromCache;
              } else {
                console.log('🔍 [GMAIL REPLY/DRAFT] Could not determine thread_id from cached email. Existing thread_id (if any):', optimizedParams.thread_id);
              }

              // Determine 'subject'
              const subjectFromCache = secondaryEmailDataSource?.subject || primaryEmailDataSource?.subject;
              if (subjectFromCache) {
                if (typeof subjectFromCache === 'string' && !subjectFromCache.toLowerCase().startsWith('re:')) {
                  optimizedParams.subject = `Re: ${subjectFromCache}`;
                } else {
                  optimizedParams.subject = subjectFromCache; 
                }
                console.log(`🔍 [GMAIL REPLY/DRAFT] Auto-populated SUBJECT field: ${optimizedParams.subject}`);
              } else {
                console.log('🔍 [GMAIL REPLY/DRAFT] No "subject" found in cached email.');
              }

              // Handle Email Body for Gmail reply/draft tools
              // For draft reply tools, if we have input but no body, use input as body
              if (toolCall.name.includes('create_draft_reply') && toolCall.params.input && !toolCall.params.body) {
                optimizedParams.body = toolCall.params.input;
                console.log('🔍 [GMAIL BODY GEN] Copying input to body for draft reply');
              }
              
              if (toolCall.params.body || optimizedParams.body) {
                  console.log('🔍 [GMAIL BODY GEN] AI provided an explicit `body`. Processing for HTML formatting.');
                  let newBody = toolCall.params.body || optimizedParams.body;
                  // Convert newlines to <br /> for HTML, unless it already seems to contain basic HTML block tags or <br>.
                  if (!(/<br\s*\/?>|<p>|<div>/i.test(newBody))) {
                      newBody = newBody.replace(/\n/g, '<br />\n');
                      console.log('🔍 [GMAIL BODY GEN] Converted newlines to <br /> for HTML.');
                  } else {
                      console.log('🔍 [GMAIL BODY GEN] Body seems to contain HTML tags, using as is regarding line breaks.');
                  }
                  optimizedParams.body = newBody;
                  optimizedParams.body_type = 'html'; // Always set to HTML if we process/provide the body
                  console.log('🔍 [GMAIL BODY GEN] Final HTML body set. Body type: html.');
                  if (toolCall.params.instructions) {
                      // If instructions are also present, pass them along as they might be used by Zapier for other things.
                      optimizedParams.instructions = toolCall.params.instructions;
                      console.log('🔍 [GMAIL BODY GEN] `instructions` also present, passing to Zapier:', toolCall.params.instructions);
                  }
              } else if (toolCall.params.instructions) {
                  // AI did not provide `body`, but provided `instructions`.
                  // Pass `instructions` to Zapier. Zapier might use this as a fallback for the body content.
                  optimizedParams.instructions = toolCall.params.instructions;
                  console.log('🔍 [GMAIL BODY GEN] AI did not provide `body`. Passing `instructions` to Zapier. Body content will be determined by Zapier (might use instructions as fallback).');
                  // We are NOT setting optimizedParams.body or optimizedParams.body_type here based on tool.params.instructions
              } else {
                  console.log('🔍 [GMAIL BODY GEN] AI provided neither `body` nor `instructions`. Email body will likely be empty or Zapier might error if body is required.');
              }

            } else {
              console.log('🔍 [GMAIL REPLY/DRAFT] Could not parse text from cachedEmailData. Details:', {
                reason: !cachedEmailData?.content?.[0]?.text ? 'No text content in cache structure' : 'JSON parse failed',
                cacheStructure: cachedEmailData ? Object.keys(cachedEmailData) : 'null',
                contentType: cachedEmailData?.content ? typeof cachedEmailData.content : 'undefined',
                contentLength: cachedEmailData?.content?.length || 0
              });
              console.log('🔍 [GMAIL REPLY/DRAFT] Skipping auto-population of to/thread_id/subject.');
            }
            } else {
              console.warn('🔍 [GMAIL REPLY/DRAFT] Attempted to process reply/draft but no cached email found');
            }
          }
          
          // --- BEGINNING OF ADDED/MODIFIED SECTION FOR INSTRUCTIONS ---
          const gmailToolsRequiringInstructionsAndBodyFormatting = [ // Renamed for clarity
            'gmail_send_email',
            'gmail_reply_to_email',
            'gmail_create_draft',
            'gmail_create_draft_reply',
          ];

          if (gmailToolsRequiringInstructionsAndBodyFormatting.includes(toolCall.name)) {
            console.log(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Tool: ${toolCall.name}. Initial instructions: '${optimizedParams.instructions}', Initial body_type: '${optimizedParams.body_type}'`);
            
            // Handle Instructions
            if (!optimizedParams.instructions || String(optimizedParams.instructions).trim() === '') {
              const subjectText = optimizedParams.subject || '';
              const defaultInstructionText = subjectText ? `Action based on subject: ${subjectText}` : `Perform ${toolCall.name}`;
              optimizedParams.instructions = `${defaultInstructionText}, as per user's directive.`;
              console.log(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Set default instructions to: '${optimizedParams.instructions}'`);
            } else {
              devLog.verbose(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Instructions already exist: '${optimizedParams.instructions}'`);
            }

            // Handle Body Formatting and Body Type
            if (typeof optimizedParams.body === 'string' && optimizedParams.body.length > 0) {
               devLog.verbose(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Processing body for HTML formatting. Initial body starts with: "${optimizedParams.body.substring(0, 50)}..."`);
               let bodyToFormat = optimizedParams.body;
               
               // Convert newlines to <br /> for HTML, unless it already seems to contain basic HTML block tags or <br>.
               if (!(/<br\s*\/?>|<p>|<div>/i.test(bodyToFormat))) {
                   bodyToFormat = bodyToFormat.replace(/\n/g, '<br />\n');
                   devLog.verbose('🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Converted newlines in body to <br /> for HTML.');
               } else {
                   devLog.verbose('🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Body seems to already contain HTML block tags or <br>, using as is for line breaks.');
            }
               optimizedParams.body = bodyToFormat;
               
               // Ensure body_type is 'html' as we've formatted it for HTML.
               optimizedParams.body_type = 'html'; 
               devLog.verbose(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Ensured body_type is 'html'. Final body starts with: "${optimizedParams.body.substring(0,50)}..."`);
            } else if (optimizedParams.body) {
              devLog.verbose(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] Body exists but is not a non-empty string. Type: ${typeof optimizedParams.body}. Skipping formatting.`);
            } else {
              devLog.verbose(`🔍 [GMAIL INSTRUCTION_BODY_HANDLER] No body found in optimizedParams for ${toolCall.name}. Skipping body formatting.`);
          }
          }
          // --- END OF ADDED/MODIFIED SECTION FOR INSTRUCTIONS ---
          
          // PHASE 2: Handle Gmail Find Email - Optimize search parameters and cache results
          if (toolCall.name.includes('find_email')) {
            devLog.verbose('🔍 [GMAIL FIND] Processing find_email optimization');
            const originalInstructions = optimizedParams.instructions || optimizedParams.query || '';
            let optimizedInstructions = originalInstructions;
            
            // Analyze user intent for result limiting
            const userQueryForIntent = originalInstructions;
            const queryLower = userQueryForIntent.toLowerCase();
            
            // Detect if user wants only the most recent email
            const wantsMostRecent = queryLower.includes('most recent') || 
                                    queryLower.includes('latest') || 
                                    queryLower.includes('last email') ||
                                    queryLower.includes('newest') ||
                                    (queryLower.includes('recent') && !queryLower.includes('recent emails'));
            
            if (wantsMostRecent) {
              devLog.verbose('🔍 [GMAIL] Detected "most recent" query, using simplified instructions');
              optimizedInstructions = originalInstructions;
              optimizedParams._internal_most_recent = true;
            }
            
            optimizedParams.instructions = optimizedInstructions;
            
            // Mark this as a find_email operation for later caching
            optimizedParams._cache_email_result = true;
          }
          
          // PHASE 3: Common Gmail optimizations
          devLog.verbose('🔍 [GMAIL] Original params:', toolCall.params);
          devLog.verbose('🔍 [GMAIL] Optimized params:', optimizedParams);
          
          // Note: Attachment processing is now handled in transformToolParameters
          // which converts attachment_url to file parameter with ?download
          
          // Log final parameters before sending to Zapier
          devLog.verbose('📧 [GMAIL FINAL] Parameters to be sent to Zapier:', {
            to: optimizedParams.to,
            subject: optimizedParams.subject,
            body: optimizedParams.body ? optimizedParams.body.substring(0, 100) + '...' : undefined,
            body_type: optimizedParams.body_type,
            file: optimizedParams.file,
            instructions: optimizedParams.instructions
          });
          
          
          // 🎯 CRITICAL FIX: Save transformed parameters back to persistent state
          // This ensures the UI displays the complete transformed parameters
          if (persistentState && toolCall.name.includes('gmail')) {
            devLog.verbose('🔍 [PARAM FIX] Updating persistent state with transformed Gmail parameters...');
            devLog.verbose('🔍 [PARAM FIX] Parameter count: original =', Object.keys(persistentState.tool_params || {}).length, 'transformed =', Object.keys(optimizedParams).length);
            
            try {
              const updatedState = await ToolExecutionStateService.update(toolCallId, {
                tool_params: optimizedParams
              });
              
              if (updatedState) {
                devLog.verbose('🔍 [PARAM FIX] ✅ Successfully updated persistent state with', Object.keys(updatedState.tool_params || {}).length, 'parameters');
              } else {
                devLog.verbose('🔍 [PARAM FIX] ❌ Failed to update persistent state');
              }
            } catch (updateError) {
              devLog.verbose('🔍 [PARAM FIX] ❌ Error updating persistent state:', updateError);
            }
          }
          
          // Tool-specific timeout for better reliability
          const timeoutMs = 35000; // 35 seconds for Gmail operations
          const timeoutMessage = 'Gmail timeout after 35 seconds';
          
          const startTime = Date.now();
          
          // Add retry logic for Gmail operations
          let retryCount = 0;
          const maxRetries = 2;
          
          while (retryCount <= maxRetries) {
            try {
              // 🔍 [EXECUTION PATH DEBUG] Add comprehensive logging to understand execution flow
              console.log('🔍 [EXECUTION PATH DEBUG] ===== GMAIL EXECUTION ANALYSIS =====');
              console.log('🔍 [EXECUTION PATH DEBUG] Tool name:', toolCall.name);
              console.log('🔍 [EXECUTION PATH DEBUG] Is Gmail tool:', toolCall.name.includes('gmail_'));
              console.log('🔍 [EXECUTION PATH DEBUG] Cached tools count:', cachedTools.length);
              console.log('🔍 [EXECUTION PATH DEBUG] Active client exists:', !!activeClient);
              console.log('🔍 [EXECUTION PATH DEBUG] Active client has executeAnyTool:', activeClient && typeof activeClient.executeAnyTool === 'function');
              console.log('🔍 [EXECUTION PATH DEBUG] Will use cached execution:', cachedTools.length > 0 && activeClient && typeof activeClient.executeAnyTool === 'function');
              
              // Use Universal MCP Client for cached tools, otherwise use the tool's execute method
              if (cachedTools.length > 0 && activeClient && typeof activeClient.executeAnyTool === 'function') {
                console.log('🔍 [GMAIL EXECUTION] Using Universal MCP Client for cached tool execution');
                
                // 🖼️ GMAIL IMAGE INJECTION: Add image injection for Gmail tools in cached execution path
                if (toolCall.name.includes('gmail_')) {
                  const sessionId = body.sessionId;
                  const metadataSessionId = toolCall.meta?.sessionId;
                  
                  console.log('🔍 [GMAIL DEBUG] ===== GMAIL TOOL EXECUTION (CACHED PATH) =====');
                  console.log('🔍 [GMAIL DEBUG] Tool name:', toolCall.name);
                  console.log('🔍 [GMAIL DEBUG] Original params:', JSON.stringify(optimizedParams, null, 2));
                  console.log('🔍 [GMAIL DEBUG] Session ID from body:', sessionId);
                  console.log('🔍 [GMAIL DEBUG] Session ID from metadata:', metadataSessionId);
                  console.log('🔍 [GMAIL DEBUG] Available image contexts:', Object.keys((globalThis as any).mcpImageContext || {}));
                  console.log('🔍 [GMAIL DEBUG] Global image context data:', JSON.stringify((globalThis as any).mcpImageContext, null, 2));
                  console.log('🔍 [GMAIL DEBUG] Body object keys:', Object.keys(body || {}));
                  console.log('🔍 [GMAIL DEBUG] ToolCall meta:', JSON.stringify(toolCall.meta, null, 2));
                  
                  let imageUrl = null;
                  
                  // Method 1: Try to get image URL from Enhanced Image Context Manager (preferred)
                  try {
                    console.log('🔍 [GMAIL DEBUG] Attempting to import Enhanced Image Context Manager...');
                    const { findImagesWithFallback } = await import('@/lib/mcp/image-context-manager');
                    console.log('🔍 [GMAIL DEBUG] ✅ Successfully imported Enhanced Image Context Manager');
                    
                    // Try to get images using the enhanced fallback method for each session ID
                    const sessionIds = [sessionId, metadataSessionId].filter(Boolean);
                    console.log('🔍 [GMAIL DEBUG] Session IDs to check:', sessionIds);
                    
                    for (const sid of sessionIds) {
                      if (sid) {
                        console.log('🔍 [GMAIL DEBUG] Checking session ID:', sid);
                        const imageUrls = findImagesWithFallback(sid);
                        console.log('🔍 [GMAIL DEBUG] findImagesWithFallback returned:', imageUrls);
                        if (imageUrls && imageUrls.length > 0) {
                          console.log('🔍 [GMAIL DEBUG] ✅ Found image URLs from Enhanced Context Manager:', imageUrls);
                          imageUrl = imageUrls[0];
                          break;
                        } else {
                          console.log('🔍 [GMAIL DEBUG] ❌ No images found for session ID:', sid);
                        }
                      }
                    }
                  } catch (imageContextError) {
                    console.log('🔍 [GMAIL DEBUG] ⚠️ Enhanced Image Context Manager not available:', imageContextError);
                  }
                  
                  // Method 2: Fallback to global context (legacy support)
                  if (!imageUrl && (globalThis as any).mcpImageContext) {
                    console.log('🔍 [GMAIL DEBUG] Checking global context fallback...');
                    const imageContext = (globalThis as any).mcpImageContext[sessionId] || 
                                       (globalThis as any).mcpImageContext[metadataSessionId];
                    
                    console.log('🔍 [GMAIL DEBUG] Global context for session:', imageContext);
                    
                    if (imageContext && (imageContext as any).imageUrl) {
                      console.log('🔍 [GMAIL DEBUG] ✅ Found image URL from global context:', (imageContext as any).imageUrl);
                      imageUrl = (imageContext as any).imageUrl;
                    } else if (imageContext && (imageContext as any).downloadableUrls) {
                      const downloadableUrls = (imageContext as any).downloadableUrls;
                      console.log('🔍 [GMAIL DEBUG] Found downloadableUrls:', downloadableUrls);
                      if (Array.isArray(downloadableUrls) && downloadableUrls.length > 0) {
                        console.log('🔍 [GMAIL DEBUG] ✅ Found downloadable URLs from global context:', downloadableUrls);
                        imageUrl = downloadableUrls[0];
                      }
                    } else {
                      console.log('🔍 [GMAIL DEBUG] ❌ No valid image data in global context');
                    }
                  } else {
                    console.log('🔍 [GMAIL DEBUG] ❌ No global context available or image already found');
                  }
                  
                  // Method 3: Emergency fallback - check all available image contexts
                  if (!imageUrl && (globalThis as any).mcpImageContext) {
                    console.log('🔍 [GMAIL DEBUG] ⚠️ Emergency fallback: No session-specific image found, checking all available contexts');
                    
                    const allContexts = Object.values((globalThis as any).mcpImageContext);
                    console.log('🔍 [GMAIL DEBUG] Emergency fallback: Found', allContexts.length, 'contexts to check');
                    
                    for (const ctx of allContexts) {
                      console.log('🔍 [GMAIL DEBUG] Emergency fallback: Checking context:', ctx);
                      if (ctx && typeof ctx === 'object' && (ctx as any).imageUrl) {
                        console.log('🔍 [GMAIL DEBUG] 🚨 Emergency fallback: Using available image URL:', (ctx as any).imageUrl);
                        imageUrl = (ctx as any).imageUrl;
                        break;
                      } else if (ctx && typeof ctx === 'object' && (ctx as any).downloadableUrls && (ctx as any).downloadableUrls.length > 0) {
                        const emergencyUrl = (ctx as any).downloadableUrls[0];
                        console.log('🔍 [GMAIL DEBUG] 🚨 Emergency fallback: Using available downloadable URL:', emergencyUrl);
                        imageUrl = emergencyUrl;
                        break;
                      }
                    }
                    
                    if (!imageUrl) {
                      console.log('🔍 [GMAIL DEBUG] ❌ Emergency fallback: No valid image found in any context');
                    }
                  }
                  
                  // Apply the image URL to parameters if found
                  if (imageUrl) {
                    console.log('🔍 [GMAIL DEBUG] ✅ Applying image URL to Gmail tool parameters:', imageUrl);
                    
                    // Gmail expects 'file' parameter
                    optimizedParams.file = imageUrl;
                    
                    // Also set attachment_url for backward compatibility
                    if (!optimizedParams.attachment_url) {
                      optimizedParams.attachment_url = imageUrl;
                    }
                    
                    console.log('🔍 [GMAIL DEBUG] ✅ Updated params with image URL:', JSON.stringify(optimizedParams, null, 2));
                  } else {
                    console.log('🔍 [GMAIL DEBUG] ❌ No image URL found from any source');
                    console.log('🔍 [GMAIL DEBUG] ❌ This may cause the Gmail tool to fail');
                  }
                }
                
                console.log('🔍 [GMAIL EXECUTION] ===== FINAL PARAMETERS ANALYSIS =====');
                console.log('🔍 [GMAIL EXECUTION] Parameters being sent to Zapier:', JSON.stringify(optimizedParams, null, 2));
                console.log('🔍 [GMAIL EXECUTION] Has file parameter:', 'file' in optimizedParams);
                console.log('🔍 [GMAIL EXECUTION] Has attachment_url parameter:', 'attachment_url' in optimizedParams);
                console.log('🔍 [GMAIL EXECUTION] File parameter value:', optimizedParams.file);
                console.log('🔍 [GMAIL EXECUTION] Attachment_url parameter value:', optimizedParams.attachment_url);
                console.log('🔍 [GMAIL EXECUTION] ===== END PARAMETERS ANALYSIS =====');
                result = await Promise.race([
                  activeClient.executeAnyTool(toolCall.name, optimizedParams),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
                  )
                ]);
              } else {
                result = await Promise.race([
                  allMcpTools[toolCall.name].execute(optimizedParams, { toolCallId: toolCallId }),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
                  )
                ]);
              }
              
              const executionTime = Date.now() - startTime;
              devLog.verbose('🔍 [GMAIL EXECUTION] Gmail tool completed in', executionTime, 'ms');
              break; // Success, exit retry loop
              
            } catch (retryError: any) {
              retryCount++;
              devLog.verbose(`🔍 [GMAIL RETRY] Attempt ${retryCount}/${maxRetries + 1} failed:`, retryError.message);
              
              if (retryCount > maxRetries) {
                throw retryError;
              }
              
              // Wait before retrying (exponential backoff)
              const waitTime = 2000 * retryCount;
              devLog.verbose(`🔍 [GMAIL RETRY] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        } else if (toolCall.name.includes('calendar') || toolCall.name.includes('event')) {
          // 📅 CALENDAR PROCESSING: Enhanced calendar tool execution with optimization
          devLog.verbose('📅 [CALENDAR] Starting calendar tool execution:', toolCall.name);
          
          // Analyze calendar intent for better parameter optimization
          const calendarIntent = analyzeCalendarIntent((persistentState as any)?.user_message || '');
          devLog.verbose('📅 [CALENDAR] Intent analysis:', calendarIntent);
          
          // Apply calendar-specific parameter transformations
          let optimizedParams = { ...toolCall.params };
          
          // Transform instructions to query if needed (similar to Gmail)
          if (optimizedParams.instructions && !optimizedParams.query) {
            let calendarQuery = optimizedParams.instructions;
            
            // Enhance query based on intent analysis
            switch (calendarIntent.timeScope) {
              case 'today':
                calendarQuery = 'today events';
                break;
              case 'tomorrow':
                calendarQuery = 'tomorrow events';
                break;
              case 'week':
                calendarQuery = 'this week events';
                break;
              case 'next':
                calendarQuery = 'upcoming events';
                break;
              default:
                calendarQuery = 'next events';
            }
            
            // Apply query transformation with proper parameter ordering
            const instructions = optimizedParams.instructions;
            optimizedParams = {};
            
            Object.defineProperty(optimizedParams, 'instructions', {
              value: instructions,
              writable: true,
              enumerable: true,
              configurable: true
            });
            
            Object.defineProperty(optimizedParams, 'query', {
              value: calendarQuery,
              writable: true,
              enumerable: true,
              configurable: true
            });
            
            devLog.verbose('📅 [CALENDAR] Transformed query:', calendarQuery);
          }
          
          // Update persistent state with optimized parameters
          if (persistentState) {
            try {
              await ToolExecutionStateService.update(toolCallId, {
                tool_params: optimizedParams
              });
              devLog.verbose('📅 [CALENDAR] ✅ Updated persistent state with optimized parameters');
            } catch (updateError) {
              devLog.verbose('📅 [CALENDAR] ❌ Error updating persistent state:', updateError);
            }
          }
          
          // Calendar-specific timeout and retry logic
          const timeoutMs = 30000; // 30 seconds for calendar operations
          const timeoutMessage = 'Calendar timeout after 30 seconds';
          
          const startTime = Date.now();
          let retryCount = 0;
          const maxRetries = 2;
          
          while (retryCount <= maxRetries) {
            try {
              devLog.verbose(`📅 [CALENDAR] Executing tool (attempt ${retryCount + 1}/${maxRetries + 1})...`);
              
              // Use Universal MCP Client for cached tools, otherwise use the tool's execute method
              if (cachedTools.length > 0 && activeClient && typeof activeClient.executeAnyTool === 'function') {
                devLog.verbose('📅 [CALENDAR] Using Universal MCP Client for cached tool execution');
                result = await Promise.race([
                  activeClient.executeAnyTool(toolCall.name, optimizedParams),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
                  )
                ]);
              } else {
                result = await Promise.race([
                  allMcpTools[toolCall.name].execute(optimizedParams, { toolCallId: toolCallId }),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
                  )
                ]);
              }
              
              const executionTime = Date.now() - startTime;
              devLog.verbose(`📅 [CALENDAR] ✅ Tool executed successfully in ${executionTime}ms`);
              break; // Success, exit retry loop
              
            } catch (retryError: any) {
              retryCount++;
              const executionTime = Date.now() - startTime;
              
              devLog.verbose(`📅 [CALENDAR] ❌ Attempt ${retryCount} failed after ${executionTime}ms:`, retryError.message);
              
              if (retryCount > maxRetries) {
                devLog.verbose(`📅 [CALENDAR] ❌ All retries exhausted, throwing error`);
                throw retryError;
              }
              
              // Exponential backoff
              const waitTime = Math.pow(2, retryCount - 1) * 1000; // 1s, 2s, 4s...
              devLog.verbose(`📅 [CALENDAR] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        } else {
          // For all other tools, merge approval params with persistent state params
          // This allows custom parameters (like _fileUrl) to be passed during approval
          const params = {}; // No custom params in current implementation
          
          // 🔍 [DEBUG] Check what's in persistent state
          console.log('🔍 [PERSISTENT STATE DEBUG] Tool name:', toolCall.name);
          console.log('🔍 [PERSISTENT STATE DEBUG] Persistent state exists:', !!persistentState);
          console.log('🔍 [PERSISTENT STATE DEBUG] Persistent state tool_params:', JSON.stringify(persistentState?.tool_params, null, 2));
          console.log('🔍 [PERSISTENT STATE DEBUG] Original toolCall params:', JSON.stringify(toolCall.params, null, 2));
          
          let paramsToUse = {
            ...(persistentState?.tool_params || toolCall.params),
            ...params  // Include any custom params from approval request
          };
          
          // 🖼️ IMAGE URL INJECTION: Check for stored image URL from user attachment
          if (toolCall.name.includes('google_drive') || toolCall.name.includes('drive_upload') || 
              toolCall.name.includes('uploadFile') || toolCall.name.includes('upload_file') ||
              toolCall.name.includes('gmail_')) {
            
            const sessionId = body.sessionId;
            const metadataSessionId = toolCall.meta?.sessionId;
            
            const isGoogleDrive = toolCall.name.includes('google_drive') || toolCall.name.includes('drive_upload') || 
                                  toolCall.name.includes('uploadFile') || toolCall.name.includes('upload_file');
            const isGmail = toolCall.name.includes('gmail_');
            const toolType = isGoogleDrive ? 'GOOGLE DRIVE' : 'GMAIL';
            
            console.log(`🔍 [${toolType} DEBUG] ===== ${toolType} TOOL EXECUTION =====`);
            console.log(`🔍 [${toolType} DEBUG] Tool name:`, toolCall.name);
            console.log(`🔍 [${toolType} DEBUG] Original params:`, JSON.stringify(paramsToUse, null, 2));
            console.log(`🔍 [${toolType} DEBUG] Session ID from body:`, sessionId);
            console.log(`🔍 [${toolType} DEBUG] Session ID from metadata:`, metadataSessionId);
            console.log(`🔍 [${toolType} DEBUG] Available image contexts:`, Object.keys((globalThis as any).mcpImageContext || {}));
            console.log(`🔍 [${toolType} DEBUG] Global image context data:`, JSON.stringify((globalThis as any).mcpImageContext, null, 2));
            
            let imageUrl = null;
            
            // Method 1: Try to get image URL from Enhanced Image Context Manager (preferred)
            try {
              const { findImagesWithFallback } = await import('@/lib/mcp/image-context-manager');
              
              // Try to get images using the enhanced fallback method for each session ID
              const sessionIds = [sessionId, metadataSessionId].filter(Boolean);
              
              for (const sid of sessionIds) {
                if (sid) {
                  const imageUrls = findImagesWithFallback(sid);
                  if (imageUrls && imageUrls.length > 0) {
                    console.log(`🔍 [${toolType} DEBUG] ✅ Found image URLs from Enhanced Context Manager:`, imageUrls);
                    imageUrl = imageUrls[0];
                    
                    // If we found multiple images, also inject additional parameters
                    if (imageUrls.length > 1) {
                      paramsToUse.files = imageUrls;
                      paramsToUse.file_urls = imageUrls;
                    }
                    break;
                  }
                }
              }
            } catch (imageContextError) {
              console.log(`🔍 [${toolType} DEBUG] ⚠️ Enhanced Image Context Manager not available:`, imageContextError);
            }
            
            // Method 2: Fallback to global context (legacy support)
            if (!imageUrl && (globalThis as any).mcpImageContext) {
              const imageContext = (globalThis as any).mcpImageContext[sessionId] || 
                                 (globalThis as any).mcpImageContext[metadataSessionId];
              
              if (imageContext && (imageContext as any).imageUrl) {
                console.log(`🔍 [${toolType} DEBUG] ✅ Found image URL from global context:`, (imageContext as any).imageUrl);
                imageUrl = (imageContext as any).imageUrl;
              } else if (imageContext && (imageContext as any).downloadableUrls) {
                const downloadableUrls = (imageContext as any).downloadableUrls;
                if (Array.isArray(downloadableUrls) && downloadableUrls.length > 0) {
                  console.log(`🔍 [${toolType} DEBUG] ✅ Found downloadable URLs from global context:`, downloadableUrls);
                  imageUrl = downloadableUrls[0];
                }
              }
              
              // If still no image URL, try to find by checking if any stored URL is valid
              if (!imageUrl) {
                console.log('🖼️ [IMAGE INJECTION] No direct session match, checking for any valid image URLs...');
                const allContexts = Object.values((globalThis as any).mcpImageContext);
                for (const ctx of allContexts) {
                  if (ctx && typeof ctx === 'object' && (ctx as any).imageUrl) {
                    console.log('🖼️ [IMAGE INJECTION] Found candidate image URL:', (ctx as any).imageUrl);
                    imageUrl = (ctx as any).imageUrl;
                    break;
                  }
                }
              }
            }
            
            // Apply the image URL to parameters if found
            if (imageUrl) {
              console.log(`🔍 [${toolType} DEBUG] ✅ Applying image URL to ${toolType} tool parameters:`, imageUrl);
              
              if (isGoogleDrive) {
                // Google Drive expects 'file' and 'file_url' parameters
                paramsToUse.file = imageUrl;
                paramsToUse.file_url = imageUrl; // Also set file_url for compatibility
                
                // Set filename if not already present
                if (!paramsToUse.filename) {
                  paramsToUse.filename = 'uploaded-image.png';
                }
              } else if (isGmail) {
                // Gmail expects 'file' parameter (similar to Google Drive)
                paramsToUse.file = imageUrl;
                
                // Also set attachment_url for backward compatibility
                if (!paramsToUse.attachment_url) {
                  paramsToUse.attachment_url = imageUrl;
                }
              }
              
              console.log(`🔍 [${toolType} DEBUG] ✅ Updated params with image URL:`, JSON.stringify(paramsToUse, null, 2));
              
              // Clean up the stored image context after use
              if ((globalThis as any).mcpImageContext) {
                delete (globalThis as any).mcpImageContext[sessionId];
                delete (globalThis as any).mcpImageContext[metadataSessionId];
                delete (globalThis as any).mcpImageContext[imageUrl];
              }
              console.log(`🔍 [${toolType} DEBUG] ✅ Cleaned up stored image context`);
            } else {
              console.log(`🔍 [${toolType} DEBUG] ❌ No image URL found from any source`);
              console.log(`🔍 [${toolType} DEBUG] ❌ This may cause the ${toolType} tool to fail`);
            }
            
            // 🔍 PARAMETER VALIDATION: Ensure file URLs are present before sending to Zapier
            if (isGoogleDrive) {
              if (!paramsToUse.file && !paramsToUse.file_url && !paramsToUse.files) {
                console.log('🚨 [VALIDATION ERROR] Google Drive upload requires file URL but none found');
                console.log('🚨 [VALIDATION ERROR] Parameters:', JSON.stringify(paramsToUse, null, 2));
                console.log('🚨 [VALIDATION ERROR] This will likely cause the Zapier upload to fail');
                
                // Don't throw error here - let Zapier handle it gracefully
                // but add a warning parameter
                paramsToUse._warning = 'No file URL found for Google Drive upload';
              } else {
                console.log('🔍 [VALIDATION SUCCESS] Google Drive upload has required file parameters');
              }
            } else if (isGmail) {
              // Gmail tools don't require file parameters, but if we have them, validate them
              if (paramsToUse.file || paramsToUse.attachment_url) {
                console.log('🔍 [VALIDATION SUCCESS] Gmail tool has attachment parameters');
              } else {
                console.log('🔍 [VALIDATION INFO] Gmail tool has no attachment parameters - this is OK for text-only emails');
              }
            }
          }
          
          // 🔍 URL VALIDATION: Check for fake URLs before execution
          if (toolCall.name.includes('google_drive') || toolCall.name.includes('drive_upload') || 
              toolCall.name.includes('uploadFile') || toolCall.name.includes('upload_file') ||
              toolCall.name.includes('gmail_')) {
            
            console.log('🔍 [URL VALIDATION] Starting validation for tool:', toolCall.name);
            console.log('🔍 [URL VALIDATION] Current params:', JSON.stringify(paramsToUse, null, 2));
            
            const fileUrl = paramsToUse.file;
            if (fileUrl && typeof fileUrl === 'string') {
              console.log('🔍 [URL VALIDATION] Checking file URL:', fileUrl);
              
              // 🔧 FIX: Handle Base64 data by converting it to downloadable URL
              if (fileUrl.startsWith('data:image/')) {
                console.log('🔍 [URL VALIDATION] ⚠️ Found Base64 image data, converting to downloadable URL');
                
                try {
                  const { processAttachedImages } = await import('@/lib/mcp/image-context-manager');
                  const sessionId = body.sessionId || toolCall.meta?.sessionId || `validation_${crypto.randomUUID()}`;
                  
                  const attachedImages = [{
                    name: `validation-converted-${Date.now()}.png`,
                    dataUrl: fileUrl
                  }];
                  
                  const downloadableUrls = await processAttachedImages(sessionId, attachedImages);
                  
                  if (downloadableUrls.length > 0) {
                    paramsToUse.file = downloadableUrls[0];
                    console.log('🔍 [URL VALIDATION] ✅ Successfully converted Base64 to downloadable URL:', downloadableUrls[0]);
                  } else {
                    console.log('🔍 [URL VALIDATION] ❌ Failed to convert Base64 to downloadable URL');
                    throw new Error(`Failed to convert Base64 image to downloadable URL. Please try again.`);
                  }
                } catch (error) {
                  console.error('🔍 [URL VALIDATION] ❌ Error converting Base64 to downloadable URL:', error);
                  throw new Error(`Error processing Base64 image: ${error.message}`);
                }
              } else {
                // Validate regular URLs (not Base64)
                console.log('🔍 [URL VALIDATION] Validating regular URL:', fileUrl);
                
                // Check for obvious fake URL patterns
                const hasFakePatterns = fileUrl.includes('abc123') || 
                                      fileUrl.includes('example.com') ||
                                      fileUrl.includes('placeholder') ||
                                      fileUrl.includes('fake-url') ||
                                      fileUrl.includes('test-image');
                
                // Check if it's a valid Supabase storage URL
                const isValidSupabaseUrl = fileUrl.includes('.supabase.') && 
                                         fileUrl.includes('/storage/v1/object/public/');
                
                // Check if it's a valid chat-images URL (supports both generated and uploaded)
                const isValidChatImageUrl = fileUrl.includes('chat-images/');
                
                const isFakeUrl = hasFakePatterns || !isValidSupabaseUrl || !isValidChatImageUrl;
                
                if (isFakeUrl) {
                  console.log('🚫 [URL VALIDATION] Detected invalid URL:', fileUrl);
                  console.log('🚫 [URL VALIDATION] Validation details:', {
                    hasFakePatterns,
                    isValidSupabaseUrl,
                    isValidChatImageUrl
                  });
                  throw new Error(`Invalid or fake URL detected: ${fileUrl}. Please use a real image URL or attach an actual image file.`);
                }
                
                console.log('✅ [URL VALIDATION] URL appears valid:', fileUrl);
              }
            }
          }
          
          console.log(`API APPROVE: Using parameters for ${toolCall.name}:`, paramsToUse);
          
          // 🔥 [FINAL EXECUTION] Log parameters being sent to MCP tool
          console.log('🔥 [FINAL EXECUTION] Parameters being sent to MCP tool:');
          console.log('🔥 [FINAL EXECUTION]', JSON.stringify(paramsToUse, null, 2));
          console.log('🔥 [FINAL EXECUTION] Has file parameter:', !!paramsToUse.file);
          console.log('🔥 [FINAL EXECUTION] Has files parameter:', !!paramsToUse.files);
          console.log('🔥 [FINAL EXECUTION] Has file_url parameter:', !!paramsToUse.file_url);
          console.log('🔥 [FINAL EXECUTION] Tool name:', toolCall.name);
          
          // 🚨 [EMERGENCY] Inject image URL directly if missing for Google Drive tools
          if (toolCall.name.includes('google_drive') && !paramsToUse.file && !paramsToUse.files) {
            console.log('🚨 [EMERGENCY] Missing file parameter for Google Drive tool, attempting direct injection');
            
            // Try to get image URL from global context
            const sessionId = body.sessionId || toolCall.meta?.sessionId;
            const globalImageContext = (globalThis as any).mcpImageContext;
            
            if (globalImageContext && sessionId) {
              const imageContext = globalImageContext[sessionId];
              if (imageContext && imageContext.downloadableUrls && imageContext.downloadableUrls.length > 0) {
                paramsToUse.file = imageContext.downloadableUrls[0];
                console.log('🚨 [EMERGENCY] Injected file URL from global context:', paramsToUse.file);
              } else if (imageContext && imageContext.imageUrl) {
                paramsToUse.file = imageContext.imageUrl;
                console.log('🚨 [EMERGENCY] Injected file URL from imageUrl:', paramsToUse.file);
              } else {
                console.log('🚨 [EMERGENCY] No downloadable URLs found in global context');
              }
            } else {
              console.log('🚨 [EMERGENCY] No global image context available');
            }
            
            // Re-log parameters after emergency injection
            console.log('🚨 [EMERGENCY] Final parameters after emergency injection:', JSON.stringify(paramsToUse, null, 2));
          }
          
          try {
          
          // 📁 GOOGLE DRIVE FILE UPLOAD: Pass URL directly to Zapier
          if ((toolCall.name.includes('google_drive') || toolCall.name.includes('drive_upload') || 
               toolCall.name.includes('uploadFile') || toolCall.name.includes('upload_file')) && 
              paramsToUse._fileUrl) {
            console.log('📁 [DRIVE UPLOAD] Detected Google Drive upload with file URL, passing URL directly...');
            
            const fileUrl = paramsToUse._fileUrl;
            
            // Make Supabase URLs downloadable for Zapier
            const downloadableUrl = fileUrl.includes('supabase.co/storage/v1/object/public/') 
              ? `${fileUrl}?download`
              : fileUrl;
            
            console.log('📁 [DRIVE UPLOAD] Original file URL:', fileUrl);
            console.log('📁 [DRIVE UPLOAD] Using downloadable URL:', downloadableUrl);
            
            // Create new params object with Zapier's expected parameter names
            // Zapier uses PascalCase and specific parameter names

            // Use new_name if provided by AI, otherwise use filename
            const providedName = paramsToUse.new_name || paramsToUse.filename || 'generated-file';

            // Check if the provided name already includes an extension
            const hasExtension = providedName.includes('.');
            let filenameWithoutExt, extension;

            if (hasExtension) {
              // IMPORTANT: Zapier automatically appends the extension, so we must send filename WITHOUT extension
              // Extract the base filename (without extension) and extension separately
              filenameWithoutExt = providedName.substring(0, providedName.lastIndexOf('.'));
              extension = providedName.substring(providedName.lastIndexOf('.') + 1);
            } else {
              // If no extension provided, use the name as-is and default to .png
              filenameWithoutExt = providedName;
              extension = 'png';
            }

            // Keep the original instructions for Zapier
            const instructions = paramsToUse.instructions ||
              `Upload ${providedName} to Google Drive`;

            // Try different parameter variations to see what Zapier accepts
            paramsToUse = {
              // Keep instructions as required by Zapier
              'instructions': instructions,
              // Map to Zapier's expected parameter names
              'Drive': paramsToUse.drive || 'My Drive', // Default to user's main drive
              'Folder': paramsToUse.folder || '/', // Root folder if not specified
              'File': downloadableUrl, // Pass downloadable URL in the File field as Zapier expects
              'file': downloadableUrl, // Also try lowercase
              'file_url': downloadableUrl, // Try underscore version
              'fileUrl': downloadableUrl, // Try camelCase
              'url': downloadableUrl, // Try just 'url'
              'URL': downloadableUrl, // Try uppercase URL
              'Convert to Document?': false, // Don't convert media files to docs
              'File Name': providedName,
              'File Extension': extension,
              // Try to force execution mode
              'isPreview': false,
              'preview': false,
              'execute': true
            };
            
            // Remove any old parameter names that Zapier doesn't expect
            delete paramsToUse._fileUrl;
            delete paramsToUse.filename;
            delete paramsToUse.mimeType;
            
            console.log('📁 [DRIVE UPLOAD] Parameters transformed for Zapier:', JSON.stringify(paramsToUse, null, 2));
            console.log('📁 [DRIVE UPLOAD] Parameter count:', Object.keys(paramsToUse).length);
            console.log('📁 [DRIVE UPLOAD] All parameter keys:', Object.keys(paramsToUse));
          }
          
          // 🔥 CONNECTION DIAGNOSTICS - Pre-execution health check
          if (toolCall.name.includes('drive') || toolCall.name.includes('gmail') || toolCall.name.includes('google_')) {
            console.log('🔍 [CONNECTION DIAGNOSTIC] Starting Zapier connection test for:', toolCall.name);
            
            try {
              // Test connection health before executing
              if (activeClient && typeof activeClient.getConnectionHealth === 'function') {
                const healthCheck = await activeClient.getConnectionHealth();
                console.log('🔍 [CONNECTION DIAGNOSTIC] Health check results:', JSON.stringify(healthCheck, null, 2));
                
                // Find Zapier connection health
                const zapierHealth = healthCheck.find(h => h.server.toLowerCase().includes('zapier'));
                if (zapierHealth) {
                  console.log('🔍 [CONNECTION DIAGNOSTIC] Zapier health:', zapierHealth);
                  
                  if (!zapierHealth.connected) {
                    console.log('🚨 [CONNECTION DIAGNOSTIC] Zapier connection is unhealthy');
                    throw new Error(`Zapier connection failed: ${zapierHealth.lastError || 'Connection not established'}`);
                  }
                  
                  if (!zapierHealth.diagnostics.canListTools) {
                    console.log('🚨 [CONNECTION DIAGNOSTIC] Zapier cannot list tools');
                    throw new Error('Zapier MCP server is connected but cannot list tools');
                  }
                  
                  if (zapierHealth.diagnostics.toolCount === 0) {
                    console.log('🚨 [CONNECTION DIAGNOSTIC] Zapier has no tools available');
                    throw new Error('Zapier MCP server has no tools available');
                  }
                  
                  if (zapierHealth.diagnostics.responseTime > 10000) {
                    console.log('⚠️ [CONNECTION DIAGNOSTIC] Zapier response time is very slow:', zapierHealth.diagnostics.responseTime, 'ms');
                  }
                  
                  console.log('✅ [CONNECTION DIAGNOSTIC] Zapier connection is healthy');
                } else {
                  console.log('⚠️ [CONNECTION DIAGNOSTIC] Zapier connection not found in health check');
                }
              }
              
              // Test specific tool availability
              if (activeClient && typeof activeClient.discoverAllTools === 'function') {
                const tools = await activeClient.discoverAllTools();
                const targetTool = tools.find(t => t.name === toolCall.name);
                
                if (!targetTool) {
                  console.log('🚨 [CONNECTION DIAGNOSTIC] Target tool not found:', toolCall.name);
                  console.log('🚨 [CONNECTION DIAGNOSTIC] Available tools:', tools.map(t => t.name));
                  throw new Error(`Tool ${toolCall.name} not available. Available tools: ${tools.map(t => t.name).join(', ')}`);
                }
                
                console.log('✅ [CONNECTION DIAGNOSTIC] Target tool found:', targetTool.name);
              }
              
              console.log('✅ [CONNECTION DIAGNOSTIC] All pre-execution checks passed');
              
            } catch (diagnosticError) {
              console.error('🚨 [CONNECTION DIAGNOSTIC] Pre-execution diagnostic failed:', diagnosticError);
              
              // For Google Drive uploads, provide specific error context
              if (toolCall.name.includes('drive') && toolCall.params?.file_url) {
                console.error('🚨 [CONNECTION DIAGNOSTIC] Google Drive upload failed - this may be due to:');
                console.error('  - Zapier MCP connection timeout');
                console.error('  - Google Drive API authentication issues');
                console.error('  - File URL not accessible');
                console.error('  - Google Drive storage quota exceeded');
                console.error('  - Network connectivity issues');
              }
              
              // Re-throw the error to fail the tool execution
              throw diagnosticError;
            }
          }
          
          // Use Universal MCP Client for cached tools, otherwise use the tool's execute method
          if (cachedTools.length > 0 && activeClient && typeof activeClient.executeAnyTool === 'function') {
            console.log('API APPROVE: Using Universal MCP Client for cached tool execution');
            console.log('🔍 [ZAPIER DEBUG] Tool name:', toolCall.name);
            console.log('🔍 [ZAPIER DEBUG] Parameters being sent:', JSON.stringify(paramsToUse, null, 2));

            result = await activeClient.executeAnyTool(toolCall.name, paramsToUse);

            console.log('🔍 [ZAPIER DEBUG] Execution result:', JSON.stringify(result, null, 2));
            console.log('🔍 [ZAPIER DEBUG] Result type:', typeof result);
            console.log('🔍 [ZAPIER DEBUG] Result keys:', result ? Object.keys(result) : 'null/undefined');
          } else {
            console.log('API APPROVE: Using fallback tool execution');
            console.log('API APPROVE: Available tools:', Object.keys(allMcpTools));
            console.log('API APPROVE: Looking for tool:', toolCall.name);
            console.log('🔍 [ZAPIER DEBUG] Fallback - Tool name:', toolCall.name);
            console.log('🔍 [ZAPIER DEBUG] Fallback - Parameters:', JSON.stringify(paramsToUse, null, 2));

            if (!allMcpTools[toolCall.name]) {
              console.error('🔴 [ZAPIER ERROR] Tool not found! Available Zapier tools:',
                Object.keys(allMcpTools).filter(name => name.includes('gmail') || name.includes('zapier')));
              throw new Error(`Tool ${toolCall.name} not found in allMcpTools. Available Gmail tools: ${
                Object.keys(allMcpTools).filter(name => name.includes('gmail')).join(', ')
              }`);
            }

            result = await allMcpTools[toolCall.name].execute(
              paramsToUse,
              { toolCallId: toolCallId }
            );

            console.log('🔍 [ZAPIER DEBUG] Fallback execution result:', JSON.stringify(result, null, 2));
            console.log('🔍 [ZAPIER DEBUG] Fallback result type:', typeof result);
          }
          } catch (innerError) {
            console.error('🔴 [ERROR] Error in tool-specific processing:', innerError);
            console.error('🔴 [ERROR] Error details:', {
              message: innerError.message,
              stack: innerError.stack,
              toolName: toolCall.name,
              paramsToUse
            });
            throw innerError;
          }
        }
        
        // Parse Zapier MCP response if it's wrapped in content array
        if (result && result.content && Array.isArray(result.content)) {
          console.log('🔍 [ZAPIER RESPONSE] Detected wrapped Zapier response, unwrapping...');

          // Zapier returns response in content[0].text as JSON string
          const contentItem = result.content[0];
          if (contentItem && contentItem.type === 'text' && contentItem.text) {
            try {
              const parsedResult = JSON.parse(contentItem.text);
              console.log('🔍 [ZAPIER RESPONSE] Parsed inner JSON:', JSON.stringify(parsedResult, null, 2));

              // Extract the actual result
              if (parsedResult.results && parsedResult.execution) {
                const execution = parsedResult.execution;
                const results = parsedResult.results;

                // For Gmail draft creation, format a user-friendly response
                if (toolCall.name === 'gmail_create_draft' && results[0]) {
                  const draftInfo = results[0];
                  result = {
                    success: true,
                    message: `Draft email "${execution.resolvedParams?.subject?.value || 'Untitled'}" created successfully in Gmail. You can review it in your Drafts folder.`,
                    draftId: draftInfo.id,
                    threadId: draftInfo.threadId,
                    status: execution.status
                  };
                  console.log('🔍 [GMAIL DRAFT] Formatted success response:', result);
                } else {
                  // For other tools, use the results directly
                  result = {
                    success: execution.status === 'SUCCESS',
                    results: parsedResult.results,
                    execution: execution
                  };
                }
              } else {
                // Use the parsed result as-is if structure is different
                result = parsedResult;
              }
            } catch (parseError) {
              console.error('🔴 [ZAPIER RESPONSE] Failed to parse inner JSON:', parseError);
              // Keep original result if parsing fails
            }
          }
        }

        // Validate that we got a meaningful result
        if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) {
          console.error('🔴 [ZAPIER ERROR] Tool execution returned empty/null result');
          console.error('🔴 [ZAPIER ERROR] Tool:', toolCall.name);
          console.error('🔴 [ZAPIER ERROR] Parameters sent:', paramsToUse);

          // Check if this is a Gmail tool that should have created something
          if (toolCall.name.includes('gmail') && toolCall.name.includes('create')) {
            throw new Error(`Gmail draft creation failed - no response from Zapier MCP. Please check:
              1. Your Zapier MCP endpoint is correctly configured
              2. Your Gmail is connected to Zapier
              3. The Zapier MCP server is running`);
          }
        }

        // Gmail-specific payload cleanup (safety measure)
        if (toolCall.name.includes('gmail') && result) {
          const originalSize = JSON.stringify(result).length;
          result = stripGmailPayload(result);
          const strippedSize = JSON.stringify(result).length;
          console.log('🔍 [GMAIL] Payload processed:', {
            original: originalSize,
            stripped: strippedSize,
            reduction: originalSize - strippedSize,
            hasContent: result && Object.keys(result).length > 0
          });

          // Additional validation for Gmail draft creation
          if (toolCall.name === 'gmail_create_draft' && result) {
            console.log('🔍 [GMAIL DRAFT] Result validation:');
            console.log('🔍 [GMAIL DRAFT] Has id?', !!result.id);
            console.log('🔍 [GMAIL DRAFT] Has message?', !!result.message);
            console.log('🔍 [GMAIL DRAFT] Result preview:', JSON.stringify(result).substring(0, 200));
          }
        }

        // Calendar-specific payload cleanup and optimization
        if ((toolCall.name.includes('calendar') || toolCall.name.includes('event')) && result) {
          const originalSize = JSON.stringify(result).length;
          
          // Clean up calendar response for better performance
          if (typeof result === 'object' && result !== null) {
            // Remove unnecessary calendar API fields to reduce payload size
            const cleanResult = { ...result };
            
            // If it's an array of events, clean each event
            if (Array.isArray(cleanResult)) {
              cleanResult.forEach((event: any) => {
                if (event && typeof event === 'object') {
                  // Keep essential fields, remove bloat
                  delete event.htmlLink;
                  delete event.iCalUID;
                  delete event.etag;
                  delete event.kind;
                  delete event.visibility;
                  delete event.colorId;
                  delete event.eventType;
                }
              });
            } else if (cleanResult.events && Array.isArray(cleanResult.events)) {
              // Handle wrapped event arrays
              cleanResult.events.forEach((event: any) => {
                if (event && typeof event === 'object') {
                  delete event.htmlLink;
                  delete event.iCalUID;
                  delete event.etag;
                  delete event.kind;
                  delete event.visibility;
                  delete event.colorId;
                  delete event.eventType;
                }
              });
            }
            
            result = cleanResult;
          }
          
          const cleanedSize = JSON.stringify(result).length;
          devLog.verbose('📅 [CALENDAR] Payload processed:', {
            original: originalSize,
            cleaned: cleanedSize,
            reduction: originalSize - cleanedSize
          });
        }
        
        // Gmail-specific detailed logging for debugging
        if (toolCall.name.includes('gmail')) {
          console.log('🔍 [GMAIL DEBUG] =================================');
          console.log('🔍 [GMAIL] Tool Name:', toolCall.name);
          console.log('🔍 [GMAIL] Raw MCP Response:', JSON.stringify(result, null, 2));
          console.log('🔍 [GMAIL] Response Type:', typeof result);
          console.log('🔍 [GMAIL] Response Keys:', Object.keys(result || {}));
          console.log('🔍 [GMAIL] Is Array?:', Array.isArray(result));
          console.log('🔍 [GMAIL] Result Content:', result?.content);
          console.log('🔍 [GMAIL] Result Data:', result?.data);
          console.log('🔍 [GMAIL] Result Emails:', result?.emails);
          console.log('🔍 [GMAIL] Result Success:', result?.success);
          console.log('🔍 [GMAIL DEBUG] =================================');
        }
        
        // Calendar comparison logging 
        if (toolCall.name.includes('calendar')) {
          console.log('📅 [CALENDAR DEBUG] =============================');
          console.log('📅 [CALENDAR] Tool Name:', toolCall.name);
          console.log('📅 [CALENDAR] Raw MCP Response:', JSON.stringify(result, null, 2));
          console.log('📅 [CALENDAR] Response Type:', typeof result);
          console.log('📅 [CALENDAR] Response Keys:', Object.keys(result || {}));
          console.log('📅 [CALENDAR DEBUG] =============================');
        }
        
        // Store and mark execution state
        toolApprovalState[toolCallId].result = result;
        console.log(`API APPROVE: Tool execution successful, result:`, result);

        if (global.toolApprovalState) {
          global.toolApprovalState[toolCallId].executed = true;
          global.toolApprovalState[toolCallId].result = result;
        }
        
        // GMAIL_FIX_PLAN.md: Phase 2, Step 1: Verify cache population during find_email
        console.log('🔍 [CACHE CHECK] find_email params for caching:', JSON.stringify(toolCall.params, null, 2));
        if (result && global_cache?.gmailCache) {
          // Parse the actual email data from the result structure
          let emailsToCache = [];
          try {
            if (result?.content?.[0]?.text) {
              // Old format (wrapped in content array)
              const parsed = JSON.parse(result.content[0].text);
              emailsToCache = parsed.results || [];
            } else if (result?.data?.content?.[0]?.text) {
              // Universal MCP Client with Zapier format (JSON string in content)
              const parsed = JSON.parse(result.data.content[0].text);
              emailsToCache = parsed.results || [];
            } else if (result?.data?.results) {
              // Universal MCP Client format (ToolExecutionResult with direct results)
              emailsToCache = result.data.results;
            } else if (result?.results) {
              // Direct Zapier response format
              emailsToCache = result.results;
            } else if (Array.isArray(result)) {
              emailsToCache = result;
            } else if (result && typeof result === 'object') {
              emailsToCache = [result];
            }
            
            // Update recent emails cache
            if (emailsToCache.length > 0) {
              const currentTime = Date.now();
              
              console.log(`🔍 [GMAIL CACHE] Processing ${emailsToCache.length} emails for cache`);
              
              // Add new emails to the front of the cache
              const newCacheEntries = emailsToCache.map((email: any) => {
                // Extract email address from various formats
                let fromEmail = '';
                if (typeof email.from === 'object' && email.from?.email) {
                  fromEmail = email.from.email;
                } else if (typeof email.from === 'string') {
                  fromEmail = email.from;
                } else if (email.sender) {
                  fromEmail = email.sender;
                }
                
                return {
                  id: email.id || email.messageId || email.message_id,
                  threadId: email.threadId || email.thread_id,
                  from: fromEmail,
                  fromName: (typeof email.from === 'object' && email.from?.name) ? email.from.name : '',
                  subject: email.subject || '',
                  snippet: email.snippet || email.body_plain?.substring(0, 200) || email.body?.substring(0, 200) || '',
                  timestamp: currentTime
                };
              });
              
              // Merge with existing cache, keeping most recent MAX_CACHED_EMAILS
              global_cache.gmailCache.recentEmails = [
                ...newCacheEntries,
                ...global_cache.gmailCache.recentEmails
              ].slice(0, global_cache.gmailCache.MAX_CACHED_EMAILS);
              
              // Also update lastFoundEmail for backward compatibility
              // Store in the format expected by the reply/draft code
              if (emailsToCache.length > 0 && emailsToCache[0]) {
                console.log(`🔍 [GMAIL CACHE] Storing first email in lastFoundEmail cache with proper structure`);
                global_cache.gmailCache.lastFoundEmail = {
                  content: [{
                    text: JSON.stringify({
                      execution: {
                        result: [emailsToCache[0]]
                      },
                      results: [emailsToCache[0]]
                    })
                  }]
                };
                console.log(`🔍 [GMAIL CACHE] lastFoundEmail cache structure check:`, {
                  hasContent: !!global_cache.gmailCache.lastFoundEmail?.content,
                  hasFirstContent: !!global_cache.gmailCache.lastFoundEmail?.content?.[0],
                  hasText: !!global_cache.gmailCache.lastFoundEmail?.content?.[0]?.text
                });
              } else {
                console.log(`🔍 [GMAIL CACHE] No emails to cache in lastFoundEmail`);
                global_cache.gmailCache.lastFoundEmail = null;
              }
              global_cache.gmailCache.timestamp = currentTime;
              
              console.log(`🔍 [GMAIL CACHE] Cached ${newCacheEntries.length} emails, total cached: ${global_cache.gmailCache.recentEmails.length}`);
              console.log('🔍 [GMAIL CACHE] Recent email subjects:', 
                global_cache.gmailCache.recentEmails.map(e => e.subject).slice(0, 3));
            }
          } catch (e) {
            console.error('🔍 [GMAIL CACHE] Error caching emails:', e);
          }
        }

        // GMAIL_FIX_PLAN.md: Step 3: Verify Gmail API Response Structure
        if (toolCall.name.includes('find_email') && result) {
          console.log('🔍 [GMAIL STRUCTURE] Complete email object (or first if array):', JSON.stringify(Array.isArray(result) ? result[0] : result, null, 2));
          console.log('🔍 [GMAIL STRUCTURE] Keys of email object (or first if array):', Object.keys(Array.isArray(result) ? (result[0] || {}) : (result || {})));
          if (Array.isArray(result) && result.length > 0) {
            console.log('🔍 [GMAIL STRUCTURE] First email full object from array:', JSON.stringify(result[0], null, 2));
            console.log("🔍 [GMAIL STRUCTURE] First email 'from' field:", result[0]?.from);
            console.log("🔍 [GMAIL STRUCTURE] First email 'sender' field:", result[0]?.sender);
            console.log("🔍 [GMAIL STRUCTURE] First email 'reply_to' field:", result[0]?.reply_to);
          } else if (!Array.isArray(result) && result) {
            console.log("🔍 [GMAIL STRUCTURE] Email 'from' field:", result?.from);
            console.log("🔍 [GMAIL STRUCTURE] Email 'sender' field:", result?.sender);
            console.log("🔍 [GMAIL STRUCTURE] Email 'reply_to' field:", result?.reply_to);
          }
        }

        /* ------------------------------------------------------------------
           Helper: Generate a user-friendly summary for ANY tool execution
        ------------------------------------------------------------------*/
        const summarizeResult = async (call: any, rawResult: any): Promise<{ content: any[]; isError: boolean }> => {
          // If the tool itself reports an error, propagate it verbatim
          if (rawResult?.isError) return rawResult;

          const toolName = (call.name || '').toLowerCase();
          const params = call.params || {};

          const makeText = (text: string) => ({ type: 'text', text });


          // Gmail tools
          if (toolName.includes('gmail')) {
            if (toolName.includes('create_draft_reply')) {
              const threadInfo = params.thread_id ? ` (replying to thread ${params.thread_id.substring(0, 8)}...)` : '';
              const subjectInfo = params.subject ? ` with subject "${params.subject}"` : '';
              return {
                content: [makeText(`Draft reply${subjectInfo} created successfully in Gmail${threadInfo}. You can review it in your Drafts folder.`)],
                isError: false
              };
            }
            if (toolName.includes('create_draft')) {
              return {
                content: [makeText(`Draft email "${params.subject || 'Untitled'}" created successfully in Gmail. You can review it in your Drafts folder.`)],
                isError: false
              };
            }
            if (toolName.includes('find_email')) {
              let count = 0;
              
              try {
                let emails = [];
                let parsed: any = null;
                
                // Handle different response formats from MCP SDK
                if (rawResult?.content?.[0]?.text) {
                  // Old format (wrapped in content array)
                  parsed = JSON.parse(rawResult.content[0].text);
                  emails = parsed.results || [];
                } else if (rawResult?.data?.content?.[0]?.text) {
                  // Universal MCP Client with Zapier format (JSON string in content)
                  parsed = JSON.parse(rawResult.data.content[0].text);
                  emails = parsed.results || [];
                } else if (rawResult?.data?.results) {
                  // Universal MCP Client format (ToolExecutionResult with direct results)
                  emails = rawResult.data.results;
                  parsed = rawResult.data;
                } else if (rawResult?.results) {
                  // Direct Zapier response format
                  emails = rawResult.results;
                  parsed = rawResult;
                }
                
                count = emails.length;
                console.log('🔍 [SUMMARY] Processing', count, 'emails from results');
                
                if (count === 0) {
                  // Determine the right message based on search type
                  const queryUsed = parsed?.execution?.params?.instructions || parsed?.execution?.params?.query || 'unknown query';
                  console.log('🔍 [SUMMARY] No emails found for query:', queryUsed);
                  
                  if (queryUsed.includes('from:')) {
                    const sender = queryUsed.match(/from:["']?([^"'\s]+)["']?/)?.[1] || 'that sender';
                    return {
                      content: [makeText(`No emails found from ${sender}. This could mean:\n\n• No emails exist from this sender\n• The sender name might be slightly different\n• Try searching for part of the sender name\n\nExample: Instead of "John Smith" try "John" or "Smith"`)] ,
                      isError: false
                    };
                  } else if (queryUsed.includes('newer_than:1h')) {
                    return {
                      content: [makeText('No emails found in the last hour. Try expanding your search with "newer_than:1d" or "newer_than:1w" for a broader time range.')],
                      isError: false
                    };
                  } else {
                    return {
                      content: [makeText('No emails found matching your search criteria. Try using more specific terms or expanding your time range.')],
                      isError: false
                    };
                  }
                } else {
                  // Use GPT-5 Nano to intelligently summarize the email content
                  console.log('🔍 [SUMMARY] Calling GPT-5 Nano for email summarization');
                  const summarizedContent = await summarizeEmailsWithGPT(emails, params.instructions || params.query || 'Find my recent emails');
                  
                  return {
                    content: [makeText(summarizedContent)],
                    isError: false
                  };
                }
              } catch (error) {
                console.error('🔍 [SUMMARY] Error processing email data:', error);
                // Fallback to basic formatting if GPT summarization fails
                try {
                  let emails = [];
                  let parsed: any = null;
                  if (rawResult?.content?.[0]?.text) {
                    // Old format (wrapped in content array)
                    parsed = JSON.parse(rawResult.content[0].text);
                    emails = parsed.results || [];
                  } else if (rawResult?.data?.content?.[0]?.text) {
                    // Universal MCP Client with Zapier format (JSON string in content)
                    parsed = JSON.parse(rawResult.data.content[0].text);
                    emails = parsed.results || [];
                  } else if (rawResult?.data?.results) {
                    // Universal MCP Client format (ToolExecutionResult with direct results)
                    emails = rawResult.data.results;
                  } else if (rawResult?.results) {
                    // Direct response format
                    emails = rawResult.results;
                  }
                  
                  if (emails.length > 0) {
                    const emailDetails = emails.slice(0, 3).map((email: any, index: number) => 
                      `${index + 1}. **${email.subject}**\n   From: ${typeof email.from === 'object' && email.from?.email ? email.from.email : email.from}\n   Date: ${email.date}\n   Preview: ${email.snippet}`
                    ).join('\n\n');
                    
                    return {
                      content: [makeText(`Found ${emails.length} email${emails.length !== 1 ? 's' : ''}:\n\n${emailDetails}`)],
                      isError: false
                    };
                  }
                } catch (fallbackError) {
                  console.error('🔍 [SUMMARY] Fallback formatting also failed:', fallbackError);
                }
                
                return {
                  content: [makeText('Gmail search completed but response format was unexpected. Try a more specific search.')],
                  isError: false
                };
              }
            }
            return { content: [makeText('Gmail action completed successfully.')], isError: false };
          }

          // Calendar tools
          if (toolName.includes('calendar')) {
            if (toolName.includes('create_calendar')) {
              return { content: [makeText(`I've created a new Google Calendar named "${params.summary || 'Untitled Calendar'}".`)], isError: false };
            }

            // Handle Quick Add Event specifically for a more accurate message
            if (toolName.includes('quick_add_event')) {
              let count = 0;
              let formattedEventText = '';
              try {
                // Handle different response formats from MCP SDK
                if (rawResult?.content && Array.isArray(rawResult.content) && rawResult.content[0]?.type === 'text') {
                  // Old format (wrapped in content array)
                  const jsonString = rawResult.content[0].text;
                  const parsedData = JSON.parse(jsonString);
                  if (parsedData.results && Array.isArray(parsedData.results)) {
                    count = parsedData.results.length;
                    if (count > 0) {
                      formattedEventText = formatCalendarEvents(parsedData.results);
                    }
                  }
                } else if (rawResult?.data?.content?.[0]?.text) {
                  // Universal MCP Client with Zapier format (JSON string in content)
                  const jsonString = rawResult.data.content[0].text;
                  const parsedData = JSON.parse(jsonString);
                  if (parsedData.results && Array.isArray(parsedData.results)) {
                    count = parsedData.results.length;
                    if (count > 0) {
                      formattedEventText = formatCalendarEvents(parsedData.results);
                    }
                  }
                } else if (rawResult?.data?.results) {
                  // Universal MCP Client format (ToolExecutionResult with direct results)
                  count = rawResult.data.results.length;
                  if (count > 0) {
                    formattedEventText = formatCalendarEvents(rawResult.data.results);
                  }
                } else if (rawResult?.results) {
                  // Direct response format
                  count = rawResult.results.length;
                  if (count > 0) {
                    formattedEventText = formatCalendarEvents(rawResult.results);
                  }
                }
              } catch (e) {
                console.error('Error parsing calendar quick_add_event results:', e);
              }

              if (count === 0) {
                // This case should ideally not happen for a successful quick_add
                return { content: [makeText('I tried to add an event, but it seems something went wrong or no event was created.')], isError: true };
              } else {
                return {
                  content: [makeText(`I've added ${count} event${count !== 1 ? 's' : ''} to your calendar:

${formattedEventText}`)],
                  isError: false
                };
              }
            }
            
            // Handle Find Event and other general event tools
            if (toolName.includes('find_event') || toolName.includes('event')) {
              let count = 0;
              let formattedEventText = '';
              
              try {
                // Handle different response formats from MCP SDK
                if (rawResult?.content && Array.isArray(rawResult.content) && rawResult.content[0]?.type === 'text') {
                  // Old format (wrapped in content array)
                  const jsonString = rawResult.content[0].text;
                  const parsedData = JSON.parse(jsonString);
                  
                  if (parsedData.results && Array.isArray(parsedData.results)) {
                    count = parsedData.results.length;
                    
                    // Format the events in a user-friendly way if we have results
                    if (count > 0) {
                      formattedEventText = formatCalendarEvents(parsedData.results);
                    }
                  }
                } else if (rawResult?.data?.content?.[0]?.text) {
                  // Universal MCP Client with Zapier format (JSON string in content)
                  const jsonString = rawResult.data.content[0].text;
                  const parsedData = JSON.parse(jsonString);
                  
                  if (parsedData.results && Array.isArray(parsedData.results)) {
                    count = parsedData.results.length;
                    
                    // Format the events in a user-friendly way if we have results
                    if (count > 0) {
                      formattedEventText = formatCalendarEvents(parsedData.results);
                    }
                  }
                } else if (rawResult?.data?.results) {
                  // Universal MCP Client format (ToolExecutionResult with direct results)
                  count = rawResult.data.results.length;
                  if (count > 0) {
                    formattedEventText = formatCalendarEvents(rawResult.data.results);
                  }
                } else if (rawResult?.results) {
                  // Direct response format
                  count = rawResult.results.length;
                  if (count > 0) {
                    formattedEventText = formatCalendarEvents(rawResult.results);
                  }
                } else {
                  // Fall back to original logic if the structure is different
                  const events = rawResult?.events || rawResult;
                  count = Array.isArray(events) ? events.length : 0;
                  
                  // Format events from the alternative structure if available
                  if (count > 0) {
                    formattedEventText = formatCalendarEvents(events);
                  }
                }
              } catch (e) {
                console.error('Error parsing calendar event results:', e);
              }
              
              if (count === 0) {
                return { content: [makeText(`I found ${count} calendar events matching your request.`)], isError: false };
              } else {
                return { 
                  content: [makeText(`I found ${count} calendar event${count !== 1 ? 's' : ''} matching your request:\n\n${formattedEventText}`)], 
                  isError: false 
                };
              }
            }
            return { content: [makeText('Google Calendar action completed successfully.')], isError: false };
          }

          // WhatsApp / 2chat
          if (toolName.includes('whatsapp') || toolName.includes('2chat')) {
            return { content: [makeText('Your WhatsApp message has been sent via 2Chat. Check the conversation thread for confirmation.')], isError: false };
          }

          // GitHub tools
          if (toolName.includes('github')) {
            if (toolName.includes('find_repository')) {
              const repos = rawResult?.items || rawResult?.repositories || rawResult;
              const count = Array.isArray(repos) ? repos.length : 0;
              return { content: [makeText(`I found ${count} GitHub repositor${count === 1 ? 'y' : 'ies'} that match your criteria.`)], isError: false };
            }
            return { content: [makeText('GitHub action completed successfully.')], isError: false };
          }

          // Google Drive tools
          if (toolName.includes('google_drive') || toolName.includes('drive_upload') || toolName.includes('drive_create')) {
            console.log(`[GOOGLE DRIVE] Processing result for ${toolName}:`, JSON.stringify(rawResult, null, 2));
            
            // Check if this is a successful upload
            if (toolName.includes('upload_file') || toolName.includes('drive_upload')) {
              // Check for various success indicators
              const isSuccess = 
                rawResult?.success === true || 
                rawResult?.Success === true ||
                rawResult?.status === 'success' ||
                rawResult?.Status === 'Success' ||
                (rawResult?.data && !rawResult?.error) ||
                (rawResult?.content && !rawResult?.error);
              
              // Check if this is a Zapier follow-up question (which means it didn't actually upload)
              const hasFollowUpQuestion = 
                rawResult?.data?.content?.[0]?.text?.includes('followUpQuestion') ||
                rawResult?.content?.[0]?.text?.includes('followUpQuestion');
              
              if (hasFollowUpQuestion) {
                console.log('[GOOGLE DRIVE] Detected follow-up question from Zapier - upload may have failed');
                return {
                  content: [makeText('⚠️ Google Drive upload requires additional information. Please ensure the file URL is accessible and try again.')],
                  isError: false
                };
              }
              
              if (isSuccess) {
                return {
                  content: [makeText('✅ File uploaded successfully to Google Drive!')],
                  isError: false
                };
              } else if (rawResult?.error) {
                return {
                  content: [makeText(`❌ Failed to upload file to Google Drive: ${rawResult.error}`)],
                  isError: true
                };
              }
            }
            
            // For folder creation
            if (toolName.includes('create_folder')) {
              const folderName = rawResult?.name || rawResult?.folderName || 'New Folder';
              return {
                content: [makeText(`📁 Created folder "${folderName}" in Google Drive successfully!`)],
                isError: false
              };
            }
            
            // Generic Google Drive success
            return { content: [makeText('Google Drive action completed successfully.')], isError: false };
          }

          // 🎯 CRITICAL FIX: Universal fallback - return actual tool result instead of generic message
          console.log(`[UNIVERSAL FALLBACK] Tool "${call.name}" not specifically handled, returning raw result`);
          console.log(`[UNIVERSAL FALLBACK] Raw result:`, JSON.stringify(rawResult, null, 2));
          
          // For unhandled tools, return the actual result instead of generic message
          // This ensures CoinGecko and other MCP tools display their actual data
          if (rawResult && rawResult.content) {
            console.log(`[UNIVERSAL FALLBACK] Returning raw result with content`);
            
            // Check if content contains a Zapier follow-up question
            if (Array.isArray(rawResult.content) && rawResult.content.length > 0) {
              const firstContent = rawResult.content[0];
              if (firstContent?.text?.includes('followUpQuestion')) {
                try {
                  const parsed = JSON.parse(firstContent.text);
                  if (parsed.followUpQuestion) {
                    return {
                      content: [makeText(`⚠️ ${parsed.followUpQuestion}`)],
                      isError: false
                    };
                  }
                } catch (e) {
                  // Not JSON, continue with normal processing
                }
              }
            }
            
            return {
              content: rawResult.content,
              isError: false
            };
          } else if (rawResult) {
            console.log(`[UNIVERSAL FALLBACK] Processing raw result with universal formatter`);
            
            // Clean up the raw result to remove technical metadata
            let cleanedResult = rawResult;
            
            // If rawResult has a specific structure with Success/Data/Metadata, extract the actual data
            if (typeof rawResult === 'object' && rawResult !== null) {
              // First check for Zapier response structure
              if (rawResult.success !== undefined && rawResult.data && rawResult.metadata) {
                // This is a Zapier/MCP response structure
                console.log(`[UNIVERSAL FALLBACK] Detected Zapier/MCP response structure`);
                
                // Extract the actual content from the data
                if (rawResult.data.content && Array.isArray(rawResult.data.content)) {
                  const content = rawResult.data.content;
                  if (content.length > 0 && content[0].text) {
                    try {
                      // Try to parse as JSON (Zapier often returns JSON in text)
                      const parsed = JSON.parse(content[0].text);
                      if (parsed.followUpQuestion) {
                        return {
                          content: [makeText(`⚠️ ${parsed.followUpQuestion}`)],
                          isError: false
                        };
                      }
                      // Use the parsed content
                      cleanedResult = parsed;
                    } catch (e) {
                      // Not JSON, use as-is
                      cleanedResult = content[0].text;
                    }
                  }
                } else {
                  cleanedResult = rawResult.data;
                }
              } else if (rawResult.data) {
                cleanedResult = rawResult.data;
              } else if (rawResult.Data) {
                cleanedResult = rawResult.Data;
              } else if (rawResult.result) {
                cleanedResult = rawResult.result;
              } else if (rawResult.Result) {
                cleanedResult = rawResult.Result;
              }
              
              // Remove technical metadata fields
              if (typeof cleanedResult === 'object' && cleanedResult !== null) {
                const { 
                  Success, success, 
                  Metadata, metadata, 
                  executionTime, ExecutionTime,
                  server, Server,
                  isPreview,
                  ...actualData 
                } = cleanedResult as any;
                
                // If we have actual data after removing metadata, use it
                if (Object.keys(actualData).length > 0) {
                  cleanedResult = actualData;
                }
              }
            }
            
            // Use the universal formatter to create user-friendly output
            const formattedResult = formatToolResultUniversally(cleanedResult, call.name);
            
            return {
              content: [makeText(formattedResult.markdown)],
              isError: false
            };
          } else {
            console.log(`[UNIVERSAL FALLBACK] No raw result, using generic message`);
            return {
              content: [makeText(`The tool "${call.name}" executed successfully. Please review the output in your MCP pipeline if further action is needed.`)],
              isError: false
            };
          }
        };

        // Pre-formatting logging for Gmail vs Calendar
        if (toolCall.name.includes('gmail')) {
          console.log('🔍 [GMAIL FORMATTING] About to format result...');
          console.log('🔍 [GMAIL FORMATTING] Pre-format result:', JSON.stringify(result, null, 2));
        }
        
        if (toolCall.name.includes('calendar')) {
          console.log('📅 [CALENDAR FORMATTING] About to format result...');
          console.log('📅 [CALENDAR FORMATTING] Pre-format result:', JSON.stringify(result, null, 2));
        }
        
        let formattedResult = await summarizeResult(toolCall, result);
        
        // Post-formatting logging for Gmail vs Calendar
        if (toolCall.name.includes('gmail')) {
          console.log('🔍 [GMAIL FORMATTING] Post-format result:', JSON.stringify(formattedResult, null, 2));
          console.log('🔍 [GMAIL FORMATTING] Formatted result type:', typeof formattedResult);
          console.log('🔍 [GMAIL FORMATTING] Formatted content length:', formattedResult?.content?.length);
        }
        
        if (toolCall.name.includes('calendar')) {
          console.log('📅 [CALENDAR FORMATTING] Post-format result:', JSON.stringify(formattedResult, null, 2));
          console.log('📅 [CALENDAR FORMATTING] Formatted result type:', typeof formattedResult);
          console.log('📅 [CALENDAR FORMATTING] Formatted content length:', formattedResult?.content?.length);
        }
        
        // Enhanced error handling for Google Calendar tools
        if (toolCall.name.includes('calendar') && toolCall.name.includes('find_event')) {
          try {
            // Check if the result indicates no events found
            const resultContent = result?.content?.[0]?.text;
            if (resultContent) {
              const parsedResult = JSON.parse(resultContent);
              if (parsedResult.results && Array.isArray(parsedResult.results) && parsedResult.results.length === 0) {
                console.log('API APPROVE: No calendar events found, providing helpful feedback');
                
                // Provide more helpful feedback about time ranges
                const timeRangeHelp = {
                  content: [{
                    type: 'text',
                    text: `I searched your Google Calendar but didn't find any events matching your criteria. This could be because:

1. **Time Range**: The search might be looking in the wrong time period. Try being more specific:
   - "Show me today's events"
   - "What's on my calendar this week?"
   - "Do I have any meetings tomorrow?"

2. **Calendar Access**: Make sure the calendar you want to search is accessible and properly connected.

3. **Event Timing**: If you're looking for upcoming events, they might be scheduled outside the current search window.

Would you like me to search for events in a different time range, or would you prefer to check a specific day or week?`
                  }],
                  isError: false
                };
                
                return NextResponse.json({ 
                  success: true,
                  result: timeRangeHelp,
                  toolCallId,
                  calendarSearchOptimized: true
                });
              }
            }
          } catch (e) {
            // If parsing fails, continue with normal flow
            console.log('API APPROVE: Could not parse calendar result for enhanced feedback:', e);
          }
        }
        
        // Final response logging for Gmail vs Calendar
        if (toolCall.name.includes('gmail')) {
          console.log('🔍 [GMAIL FINAL] About to return successful response...');
          console.log('🔍 [GMAIL FINAL] Final response data:', {
            success: true,
            result: formattedResult,
            toolCallId,
            resultKeys: Object.keys(formattedResult || {}),
            contentCount: formattedResult?.content?.length
          });
        }
        
        if (toolCall.name.includes('calendar')) {
          console.log('📅 [CALENDAR FINAL] About to return successful response...');
          console.log('📅 [CALENDAR FINAL] Final response data:', {
            success: true,
            result: formattedResult,
            toolCallId,
            resultKeys: Object.keys(formattedResult || {}),
            contentCount: formattedResult?.content?.length
          });
        }
        
        // 🔥 RESULT VALIDATION - Prevent empty responses
        console.log('🔍 [RESULT VALIDATION] Validating formatted result...');
        console.log('🔍 [RESULT VALIDATION] Formatted result type:', typeof formattedResult);
        console.log('🔍 [RESULT VALIDATION] Formatted result value:', JSON.stringify(formattedResult, null, 2));
        
        // Validate that formattedResult is not empty/null/undefined
        if (!formattedResult) {
          console.error('🔍 [RESULT VALIDATION] ERROR: formattedResult is null/undefined');
          console.error('🔍 [RESULT VALIDATION] Raw result was:', JSON.stringify(result, null, 2));
          console.error('🔍 [RESULT VALIDATION] Tool call was:', JSON.stringify(toolCall, null, 2));
          
          // Create a fallback response with the raw result
          const fallbackResult = {
            content: [{
              type: 'text',
              text: result ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) : 'Tool execution completed but no result was returned.'
            }],
            isError: false
          };
          
          console.log('🔍 [RESULT VALIDATION] Using fallback result:', JSON.stringify(fallbackResult, null, 2));
          formattedResult = fallbackResult;
        }
        
        // Validate that formattedResult has proper structure
        if (typeof formattedResult !== 'object' || !formattedResult.content || !Array.isArray(formattedResult.content)) {
          console.error('🔍 [RESULT VALIDATION] ERROR: formattedResult has invalid structure');
          console.error('🔍 [RESULT VALIDATION] Expected: { content: [...], isError: boolean }');
          console.error('🔍 [RESULT VALIDATION] Got:', JSON.stringify(formattedResult, null, 2));
          
          // Fix the structure if possible
          if (typeof formattedResult === 'string') {
            formattedResult = {
              content: [{ type: 'text', text: formattedResult }],
              isError: false
            };
          } else if (formattedResult && typeof formattedResult === 'object') {
            // Try to extract meaningful content
            const textContent = formattedResult.text || formattedResult.message || formattedResult.response || JSON.stringify(formattedResult, null, 2);
            formattedResult = {
              content: [{ type: 'text', text: textContent }],
              isError: false
            };
          } else {
            // Last resort fallback
            formattedResult = {
              content: [{
                type: 'text',
                text: 'Tool execution completed but result format was invalid.'
              }],
              isError: false
            };
          }
          
          console.log('🔍 [RESULT VALIDATION] Fixed result structure:', JSON.stringify(formattedResult, null, 2));
        }
        
        // Final validation - ensure content array is not empty
        if (!formattedResult.content || formattedResult.content.length === 0) {
          console.error('🔍 [RESULT VALIDATION] ERROR: formattedResult.content is empty');
          
          formattedResult.content = [{
            type: 'text',
            text: 'Tool execution completed but no content was returned.'
          }];
          
          console.log('🔍 [RESULT VALIDATION] Added default content');
        }
        
        // Check if all content items are empty
        const hasValidContent = formattedResult.content.some(item => 
          item && item.text && typeof item.text === 'string' && item.text.trim().length > 0
        );
        
        if (!hasValidContent) {
          console.error('🔍 [RESULT VALIDATION] ERROR: All content items are empty');
          
          formattedResult.content = [{
            type: 'text',
            text: `Tool "${toolCall.name}" executed successfully but returned empty content.`
          }];
          
          console.log('🔍 [RESULT VALIDATION] Added meaningful default content');
        }
        
        console.log('🔍 [RESULT VALIDATION] Final validated result:', JSON.stringify(formattedResult, null, 2));
        
        // Update persistent state to completed with formatted result - use upsert to handle missing states
        if (storedToolCall) {
          // Store the formatted result instead of raw result to prevent [object Object] display issues
          await ToolExecutionStateService.upsert({
            chat_id: effectiveChatId,
            message_id: Date.now(),
            tool_call_id: toolCallId,
            tool_name: storedToolCall.name,
            tool_params: storedToolCall.params,
            status: 'completed',
            tool_result: formattedResult // Use formatted result instead of raw result
          });
        }
        
        return NextResponse.json({ 
          success: true,
          result: formattedResult,
          toolCallId
        });
      } catch (error) {
        console.error('API APPROVE: Error executing approved tool:', error);
        
        // 🔥 ENHANCED ERROR LOGGING FOR ZAPIER MCP DEBUGGING
        const err = error as any;
        console.log('🔴 [MCP ERROR] =======================================');
        console.log('🔴 [MCP ERROR] Tool Name:', toolCall?.name);
        console.log('🔴 [MCP ERROR] Tool Call ID:', toolCallId);
        console.log('🔴 [MCP ERROR] Session ID:', sessionId);
        console.log('🔴 [MCP ERROR] Error Type:', typeof error);
        console.log('🔴 [MCP ERROR] Error Message:', err?.message || 'No error message');
        console.log('🔴 [MCP ERROR] Error Stack:', err?.stack || 'No stack trace');
        console.log('🔴 [MCP ERROR] Full Error Object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
        console.log('🔴 [MCP ERROR] Tool Parameters:', JSON.stringify(toolCall?.params, null, 2));
        console.log('🔴 [MCP ERROR] Stored Tool Parameters:', JSON.stringify(storedToolCall?.params, null, 2));
        console.log('🔴 [MCP ERROR] Active Client Type:', activeClient?.constructor?.name || 'No active client');
        console.log('🔴 [MCP ERROR] Cached Tools Count:', cachedTools?.length || 0);
        console.log('🔴 [MCP ERROR] All MCP Tools Available:', Object.keys(allMcpTools || {}));
        
        // Connection diagnostics
        if (activeClient) {
          console.log('🔴 [MCP ERROR] Active Client Details:');
          console.log('🔴 [MCP ERROR] - Client endpoint:', activeClient.endpoint || 'unknown');
          console.log('🔴 [MCP ERROR] - Client connected:', activeClient.connected || 'unknown');
          console.log('🔴 [MCP ERROR] - Client tools count:', activeClient.tools?.length || 'unknown');
        }
        
        // Environment diagnostics
        console.log('🔴 [MCP ERROR] Environment Check:');
        console.log('🔴 [MCP ERROR] - Zapier endpoint set:', !!process.env.MCP_ZAPIER_ENDPOINT);
        console.log('🔴 [MCP ERROR] - Zapier endpoint value:', process.env.MCP_ZAPIER_ENDPOINT || 'NOT_SET');
        console.log('🔴 [MCP ERROR] =======================================');
        
        // Zapier-specific error diagnostics
        if (toolCall?.name?.includes('gmail') || toolCall?.name?.includes('drive')) {
          console.log('🔍 [ZAPIER ERROR] Zapier-specific diagnostics:');
          console.log('🔍 [ZAPIER ERROR] Error might be related to:');
          console.log('🔍 [ZAPIER ERROR] - Zapier MCP connection timeout');
          console.log('🔍 [ZAPIER ERROR] - Invalid webhook parameters');
          console.log('🔍 [ZAPIER ERROR] - Zapier authentication failure');
          console.log('🔍 [ZAPIER ERROR] - Google API quota/rate limits');
          console.log('🔍 [ZAPIER ERROR] - File upload restrictions (Drive)');
          console.log('🔍 [ZAPIER ERROR] - Gmail API permissions');
          
          // Check for common error patterns
          if (err?.message?.includes('timeout') || err?.message?.includes('ETIMEDOUT')) {
            console.log('🔍 [ZAPIER ERROR] TIMEOUT detected - this is likely a Zapier MCP connection issue');
          }
          if (err?.message?.includes('403') || err?.message?.includes('unauthorized')) {
            console.log('🔍 [ZAPIER ERROR] AUTH ERROR detected - check Zapier/Google permissions');
          }
          if (err?.message?.includes('400') || err?.message?.includes('Bad Request')) {
            console.log('🔍 [ZAPIER ERROR] BAD REQUEST detected - check parameter format');
          }
        }
        
        // Gmail-specific error logging and handling
        if (toolCall?.name?.includes('gmail')) {
          console.log('🔍 [GMAIL ERROR] Gmail-specific diagnostics:');
          console.log('🔍 [GMAIL ERROR] Gmail Cache State:', JSON.stringify(global_cache?.gmailCache, null, 2));
          
          // Simple Gmail timeout handling
          if (err?.message?.includes('timeout')) {
            const timeoutResult = {
              content: [{
                type: 'text',
                text: `⏱️ Gmail search timed out after 35 seconds. This might be due to:\n\n• **Network issues** - Zapier MCP connection problem\n• **Overly broad search** - Try being more specific\n• **Gmail API load** - Please wait a moment and try again\n\n**Suggestions:**\n• Try: "Find my most recent email from [sender name]"\n• Try: "Find emails with subject [subject text]"\n• Check your Gmail manually for faster access`
              }],
              isError: false
            };
            
            // Update state and return helpful response
            if (storedToolCall) {
              await ToolExecutionStateService.upsert({
                chat_id: sessionId || '00000000-0000-0000-0000-000000000000',
                message_id: Date.now(),
                tool_call_id: toolCallId,
                tool_name: storedToolCall.name,
                tool_params: storedToolCall.params,
                status: 'completed',
                tool_result: timeoutResult
              });
            }
            
            return NextResponse.json({ 
              success: true,
              result: timeoutResult,
              toolCallId,
              timeoutWarning: true
            });
          }
        }
        
        // Google Drive specific error logging
        if (toolCall?.name?.includes('drive')) {
          console.log('📁 [DRIVE ERROR] Google Drive specific diagnostics:');
          console.log('📁 [DRIVE ERROR] File URL provided:', toolCall?.params?.file_url || 'No file URL');
          console.log('📁 [DRIVE ERROR] Instructions:', toolCall?.params?.instructions || 'No instructions');
          console.log('📁 [DRIVE ERROR] File parameter:', toolCall?.params?.file || 'No file param');
          console.log('📁 [DRIVE ERROR] This might be an image upload issue to Google Drive');
          
          // Check for image upload specific errors
          if (toolCall?.params?.file_url || toolCall?.params?.file) {
            console.log('📁 [DRIVE ERROR] Image upload detected - checking for common issues:');
            console.log('📁 [DRIVE ERROR] - File size too large');
            console.log('📁 [DRIVE ERROR] - Invalid file format');
            console.log('📁 [DRIVE ERROR] - Google Drive storage quota exceeded');
            console.log('📁 [DRIVE ERROR] - Network timeout during upload');
          }
        }
        
        // Enhanced error response with comprehensive debug info
        const errorResponse = {
          error: 'Tool execution failed after approval',
          details: err?.message || String(error),
          toolName: toolCall?.name || 'unknown',
          toolCallId: toolCallId,
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
          // Add debug information that might help identify the issue
          debugInfo: {
            hasActiveClient: !!activeClient,
            activeClientType: activeClient?.constructor?.name || 'unknown',
            activeClientEndpoint: activeClient?.endpoint || 'unknown',
            toolFound: !!allMcpTools[toolCall?.name],
            cachedToolsCount: cachedTools?.length || 0,
            errorType: typeof error,
            errorConstructor: error?.constructor?.name || 'unknown',
            zapierEndpointSet: !!process.env.MCP_ZAPIER_ENDPOINT,
            hasOptimizedParams: false, // Not available in error scope
            parameterKeys: Object.keys(toolCall?.params || {}),
            // Add specific error patterns for easier debugging
            isTimeoutError: err?.message?.includes('timeout') || err?.message?.includes('ETIMEDOUT'),
            isAuthError: err?.message?.includes('403') || err?.message?.includes('unauthorized'),
            isBadRequestError: err?.message?.includes('400') || err?.message?.includes('Bad Request'),
            isNetworkError: err?.message?.includes('ECONNREFUSED') || err?.message?.includes('ENOTFOUND')
          }
        };
        
        console.log('🔴 [MCP ERROR] Enhanced error response being sent to client:');
        console.log(JSON.stringify(errorResponse, null, 2));
        
        // Update persistent state to error - use upsert to handle missing states
        if (storedToolCall) {
          try {
            await ToolExecutionStateService.upsert({
              chat_id: effectiveChatId,
              message_id: Date.now(),
              tool_call_id: toolCallId,
              tool_name: storedToolCall.name,
              tool_params: storedToolCall.params,
              status: 'error',
              error_message: `${err?.message || String(error)} | Debug: ${JSON.stringify(errorResponse.debugInfo)}`
            });
          } catch (stateError) {
            console.error('🔴 [MCP ERROR] Failed to update persistent state:', stateError);
          }
        }
        
        console.error('Tool execution error:', error);
        return NextResponse.json(errorResponse, { status: 500 });
      }
    } else if (action === 'cancel') {
      // Just mark as cancelled, no execution needed
      console.log(`API APPROVE: Tool execution cancelled by user: ${toolCallId}`);
      
      // Update persistent state to cancelled - use upsert to handle missing states
      const cancelledToolCall = toolApprovalState[toolCallId]?.toolCall;
      const cancelChatId = sessionId || '00000000-0000-0000-0000-000000000000';
      if (cancelledToolCall) {
        await ToolExecutionStateService.upsert({
          chat_id: cancelChatId,
          message_id: Date.now(),
          tool_call_id: toolCallId,
          tool_name: cancelledToolCall.name,
          tool_params: cancelledToolCall.params,
          status: 'cancelled'
        });
      }
      
      return NextResponse.json({ 
        success: true,
        cancelled: true,
        toolCallId
      });
    }
    
    // 🎯 CRITICAL FIX: Include tool results in approval response (UNIVERSAL)
    const currentToolCall = toolApprovalState[toolCallId];
    let toolResult = null;
    
    // Check multiple locations for the tool result
    if (currentToolCall?.executionResult) {
      toolResult = currentToolCall.executionResult;
      console.log('[APPROVAL API] Found tool result in global state executionResult');
    } else if (currentToolCall?.result) {
      toolResult = currentToolCall.result;
      console.log('[APPROVAL API] Found tool result in global state result');
    } else {
      // Check persistent state for the tool result
      console.log('[APPROVAL API] Checking persistent state for tool result...');
      const finalPersistentState = await ToolExecutionStateService.getByToolCallId(toolCallId);
      if (finalPersistentState?.tool_result) {
        toolResult = finalPersistentState.tool_result;
        console.log('[APPROVAL API] Found tool result in persistent state');
      }
    }
    
    if (toolResult) {
      console.log('[APPROVAL API] Including tool result in response for tool:', currentToolCall?.toolCall?.name || 'unknown');
      console.log('[APPROVAL API] Tool result structure:', JSON.stringify(toolResult, null, 2));
    } else {
      console.error('[APPROVAL API] No tool result found for tool call:', toolCallId);
      console.error('[APPROVAL API] Current global state:', JSON.stringify(currentToolCall, null, 2));
    }

    return NextResponse.json({ 
      success: true,
      toolResult: toolResult,
      toolCallId: toolCallId
    });
  } catch (error) {
    console.error('API APPROVE: Error processing tool approval:', error);
    console.error('API APPROVE: Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      { error: 'Invalid request', details: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}

/* Helper function to format calendar events in a user-friendly way */
function formatCalendarEvents(events: any[]): string {
  return events.map((event, index) => {
    // Extract event details
    const summary = event.summary || 'Untitled Event';
    
    // Format start date/time
    let startDate = '';
    let startTime = '';
    
    if (event.start) {
      if (event.start.dateTime) {
        // If we have a specific time
        const date = new Date(event.start.dateTime);
        startDate = date.toLocaleDateString('en-US', { 
          weekday: 'long',
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        });
        startTime = date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
      } else if (event.start.date) {
        // If it's an all-day event
        const date = new Date(event.start.date);
        startDate = date.toLocaleDateString('en-US', { 
          weekday: 'long',
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        });
        startTime = 'All day';
      }
    }
    
    // Get description if available
    const description = event.description ? `\n${event.description}` : '';
    
    // Return formatted event
    return `${index + 1}. ${summary}\n   ${startDate} at ${startTime}${description}`;
  }).join('\n\n');
}

/* Helper functions to extract Gmail email information from payload */
function extractSubjectFromPayload(payload: any): string | null {
  try {
    // PHASE 2: Enhanced Gmail payload structure handling
    devLog.verbose('🔍 [EXTRACT] Extracting subject from payload type:', typeof payload);
    devLog.verbose('🔍 [EXTRACT] Payload keys:', Object.keys(payload || {}));
    
    // Debug logging (removed file system logging due to errors)
    
    // FIRST: Try direct subject properties (Zapier might provide these directly)
    let subject = payload?.subject || payload?.Subject || null;
    
    if (!subject) {
      // SECOND: Try headers structure (Gmail API format)
      let headers = [];
      
      // Try multiple possible header locations based on Gmail API structure
      if (payload?.headers && Array.isArray(payload.headers)) {
        headers = payload.headers;
      } else if (payload?.payload?.headers && Array.isArray(payload.payload.headers)) {
        headers = payload.payload.headers;
      } else if (payload?.raw?.payload?.headers && Array.isArray(payload.raw.payload.headers)) {
        headers = payload.raw.payload.headers;
      }
      
      devLog.verbose('🔍 [EXTRACT] Found', headers.length, 'headers for subject extraction');
      
      const subjectHeader = headers.find((h: any) => h.name?.toLowerCase() === 'subject');
      subject = subjectHeader?.value || null;
    }
    
    devLog.verbose('🔍 [EXTRACT] Raw subject found:', subject);
    
    // PHASE 4: Data cleaning for subject
    if (subject) {
      // Clean HTML entities and invisible characters
      subject = subject
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove invisible Unicode characters
        .trim();
        
      // Limit subject length to prevent truncation
      if (subject.length > 100) {
        subject = subject.substring(0, 97) + '...';
      }
    }
    
    devLog.verbose('🔍 [EXTRACT] Extracted subject:', subject);
    return subject;
  } catch (e) {
    devLog.verbose('🔍 [EXTRACT] Error extracting subject:', e);
    return null;
  }
}

function extractFromFromPayload(payload: any): string | null {
  try {
    // PHASE 2: Enhanced Gmail payload structure handling
    devLog.verbose('🔍 [EXTRACT] Extracting from field from payload');
    
    // FIRST: Try direct from properties (Zapier MCP provides these at top level)
    // Check if it's an object with name/email properties
    let from = null;
    if (payload?.from) {
      if (typeof payload.from === 'object' && payload.from.name) {
        // Zapier format: { name: "Brilliant", email: "..." }
        from = payload.from.name;
      } else if (typeof payload.from === 'string') {
        // String format
        from = payload.from;
      }
    }
    
    // If still no from, try other property variations
    if (!from) {
      from = payload?.From || payload?.sender || payload?.Sender || 
             payload?.fromName || payload?.fromEmail || payload?.senderName || payload?.senderEmail || null;
    }
    
    if (!from) {
      // SECOND: Try headers structure (Gmail API format)
      let headers = [];
      
      // Try multiple possible header locations
      if (payload?.headers && Array.isArray(payload.headers)) {
        headers = payload.headers;
      } else if (payload?.payload?.headers && Array.isArray(payload.payload.headers)) {
        headers = payload.payload.headers;
      } else if (payload?.raw?.payload?.headers && Array.isArray(payload.raw.payload.headers)) {
        headers = payload.raw.payload.headers;
      }
      
      devLog.verbose('🔍 [EXTRACT] Found', headers.length, 'headers for from extraction');
      
      const fromHeader = headers.find((h: any) => h.name?.toLowerCase() === 'from');
      from = fromHeader?.value || null;
    }
    
    devLog.verbose('🔍 [EXTRACT] Raw from found:', from);
    
    // PHASE 4: Data cleaning for sender name
    if (from) {
      // Extract name from email format "Name <email@domain.com>" or just "email@domain.com"
      const nameMatch = from.match(/^(.*?)\s*<(.+)>$/) || from.match(/^(.+)$/);
      if (nameMatch) {
        let senderName = nameMatch[1].trim();
        if (senderName && senderName !== nameMatch[2]) {
          // Remove quotes if present
          senderName = senderName.replace(/^["']|["']$/g, '');
          from = senderName;
        } else {
          // Use just the email if no separate name
          from = nameMatch[2] || nameMatch[1];
        }
      }
      
      // Clean HTML entities and invisible characters
      from = from
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove invisible Unicode characters
        .trim();
    }
    
    devLog.verbose('🔍 [EXTRACT] Extracted from:', from);
    return from;
  } catch (e) {
    devLog.verbose('🔍 [EXTRACT] Error extracting from:', e);
    return null;
  }
}

function extractDateFromPayload(payload: any): string | null {
  try {
    // PHASE 2: Enhanced Gmail payload structure handling
    devLog.verbose('🔍 [EXTRACT] Extracting date from payload');
    
    // FIRST: Try direct date properties (Zapier might provide these directly)
    let dateValue = payload?.date || payload?.Date || payload?.timestamp || payload?.dateTime || 
                   payload?.receivedTime || payload?.sentTime || payload?.created_at || payload?.sent_at || null;
    
    if (!dateValue) {
      // SECOND: Try headers structure (Gmail API format)
      let headers = [];
      
      // Try multiple possible header locations
      if (payload?.headers && Array.isArray(payload.headers)) {
        headers = payload.headers;
      } else if (payload?.payload?.headers && Array.isArray(payload.payload.headers)) {
        headers = payload.payload.headers;
      } else if (payload?.raw?.payload?.headers && Array.isArray(payload.raw.payload.headers)) {
        headers = payload.raw.payload.headers;
      }
      
      devLog.verbose('🔍 [EXTRACT] Found', headers.length, 'headers for date extraction');
      
            const dateHeader = headers.find((h: any) => h.name?.toLowerCase() === 'date');
      dateValue = dateHeader?.value;
    }
    
    devLog.verbose('🔍 [EXTRACT] Raw date found:', dateValue);
    
    if (dateValue) {
      const date = new Date(dateValue);
      const formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      devLog.verbose('🔍 [EXTRACT] Extracted date:', formattedDate);
      return formattedDate;
    }
    
    // Fallback: try to extract date from internalDate if available
    if (!dateValue && payload?.internalDate) {
      const date = new Date(parseInt(payload.internalDate));
      const formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      devLog.verbose('🔍 [EXTRACT] Extracted date from internalDate:', formattedDate);
      return formattedDate;
    }
    
    devLog.verbose('🔍 [EXTRACT] No date found');
    return null;
  } catch (e) {
    devLog.verbose('🔍 [EXTRACT] Error extracting date:', e);
    return null;
  }
}

/* Extract body content from Gmail payload */
function extractBodyFromPayload(payload: any): string | null {
  try {
    devLog.verbose('🔍 [EXTRACT] Extracting body from payload');
    
    // FIRST: Try direct body properties (Zapier format)
    let body = payload?.body_plain || payload?.bodyPlain || payload?.body || 
               payload?.textBody || payload?.plainBody || null;
    
    if (!body && payload?.body_html) {
      // Strip HTML tags if only HTML body is available
      body = payload.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    
    if (!body) {
      // SECOND: Try Gmail API payload structure
      if (payload?.payload?.body?.data) {
        // Base64 encoded body
        try {
          body = Buffer.from(payload.payload.body.data, 'base64').toString('utf-8');
        } catch (e) {
          devLog.verbose('🔍 [EXTRACT] Failed to decode base64 body:', e);
        }
      } else if (payload?.payload?.parts) {
        // Multi-part message - look for text/plain part
        const textPart = payload.payload.parts.find((part: any) => 
          part.mimeType === 'text/plain' && part.body?.data
        );
        if (textPart?.body?.data) {
          try {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
          } catch (e) {
            devLog.verbose('🔍 [EXTRACT] Failed to decode base64 part:', e);
          }
        }
      }
    }
    
    devLog.verbose('🔍 [EXTRACT] Extracted body length:', body?.length || 0);
    return body;
  } catch (e) {
    devLog.verbose('🔍 [EXTRACT] Error extracting body:', e);
    return null;
  }
}

/* Extract labels/status from Gmail payload */
function extractLabelsFromPayload(payload: any): string[] {
  try {
    devLog.verbose('🔍 [EXTRACT] Extracting labels from payload');
    
    // Try multiple locations for labels
    let labels = payload?.labelIds || payload?.labels || 
                 payload?.raw?.labelIds || payload?.raw?.labels || [];
    
    if (!Array.isArray(labels)) {
      labels = [];
    }
    
    devLog.verbose('🔍 [EXTRACT] Found labels:', labels);
    return labels;
  } catch (e) {
    devLog.verbose('🔍 [EXTRACT] Error extracting labels:', e);
    return [];
  }
}

/* Generate preview from body content */
function generatePreviewFromBody(body: string | null, existingSnippet: string | null): string {
  if (existingSnippet && existingSnippet !== 'No preview' && existingSnippet !== 'No preview available') {
    return existingSnippet;
  }
  
  if (!body) {
    return 'No preview available';
  }
  
  // Clean up the body text and extract first meaningful content
  let preview = body
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove common email signatures and footers
  preview = preview.split(/unsubscribe|view in browser|sent from|--/i)[0];
  
  // Take first 200 characters
  if (preview.length > 200) {
    preview = preview.substring(0, 197) + '...';
  }
  
  return preview || 'No preview available';
}

/* GPT-5 nano summarization function - DEPRECATED in simplified approach */
// This function has been removed as part of the Gmail integration simplification.
// Zapier's configured filtering ('in:inbox newer_than:1h') makes complex summarization unnecessary.

/* Manual extraction function - DEPRECATED in simplified approach */
// This function has been removed as part of the Gmail integration simplification.
// The stripGmailPayload function now handles all necessary payload processing.

/* GPT-5 Nano email summarization function */
async function summarizeEmailsWithGPT(emails: any[], userQuery: string): Promise<string> {
  try {
    devLog.verbose('🔍 [GPT SUMMARY] Starting email summarization for', emails.length, 'emails');
    
    // PHASE 1: DEBUG GMAIL PAYLOAD STRUCTURE
    devLog.verbose('🔍 [DEBUG] ===== RAW GMAIL PAYLOAD ANALYSIS =====');
    devLog.verbose('🔍 [DEBUG] Raw Gmail Payload:', JSON.stringify(emails, null, 2));
    
    // Analyze each email structure
    emails.forEach((email, index) => {
      devLog.verbose(`🔍 [DEBUG] Email ${index + 1} Structure Analysis:`);
      devLog.verbose(`🔍 [DEBUG] - Top-level keys:`, Object.keys(email || {}));
      devLog.verbose(`🔍 [DEBUG] - Email object:`, JSON.stringify(email, null, 2));
      
      // Check if there's a raw.payload.headers structure
      if (email?.raw?.payload?.headers) {
        devLog.verbose(`🔍 [DEBUG] - Headers found in email.raw.payload.headers:`, email.raw.payload.headers.length, 'headers');
        email.raw.payload.headers.forEach((header: any, headerIndex: number) => {
          devLog.verbose(`🔍 [DEBUG] - Header ${headerIndex}: ${header.name} = ${header.value}`);
        });
      } else {
        devLog.verbose(`🔍 [DEBUG] - No headers found at email.raw.payload.headers`);
        if (email?.headers) {
          devLog.verbose(`🔍 [DEBUG] - Found headers at email.headers:`, email.headers);
        }
        if (email?.payload?.headers) {
          devLog.verbose(`🔍 [DEBUG] - Found headers at email.payload.headers:`, email.payload.headers);
        }
      }
      
      // Check extraction function results
      const subjectExtracted = extractSubjectFromPayload(email.raw?.payload || email);
      const fromExtracted = extractFromFromPayload(email.raw?.payload || email);
      const dateExtracted = extractDateFromPayload(email.raw?.payload || email);
      
      devLog.verbose(`🔍 [DEBUG] - Extraction Results:`);
      devLog.verbose(`🔍 [DEBUG]   - Subject: "${subjectExtracted}"`);
      devLog.verbose(`🔍 [DEBUG]   - From: "${fromExtracted}"`);
      devLog.verbose(`🔍 [DEBUG]   - Date: "${dateExtracted}"`);
      devLog.verbose(`🔍 [DEBUG] - Direct properties:`);
      devLog.verbose(`🔍 [DEBUG]   - email.subject: "${email.subject}"`);
      devLog.verbose(`🔍 [DEBUG]   - email.from: "${email.from}"`);
      devLog.verbose(`🔍 [DEBUG]   - email.date: "${email.date}"`);
      devLog.verbose(`🔍 [DEBUG]   - email.snippet: "${email.snippet}"`);
    });
    devLog.verbose('🔍 [DEBUG] ===== END PAYLOAD ANALYSIS =====');
    
    // PHASE 5: Enhanced user query processing for single vs multiple emails
    // Analyze user intent for email processing
    const userQueryLower = userQuery.toLowerCase();
    const wantsSingleEmail = userQueryLower.includes('most recent') || 
                            userQueryLower.includes('latest') || 
                            userQueryLower.includes('last email') ||
                            userQueryLower.includes('newest') ||
                            (userQueryLower.includes('recent') && !userQueryLower.includes('recent emails'));
    
    // If user wants single email but we have multiple, prioritize the first (most recent)
    let emailsToProcess = emails;
    if (wantsSingleEmail && emails.length > 1) {
      devLog.verbose('🔍 [GPT SUMMARY] User wants single email, using only the first (most recent)');
      emailsToProcess = emails.slice(0, 1);
    }
    
    // Prepare email data for GPT processing
    const emailData = emailsToProcess.slice(0, 10).map((email, index) => {
      // Use already-extracted values or extract them if needed
      let from = email.from;
      if (typeof from === 'object' && from?.name) {
        from = from.name; // Handle Zapier object format: {name: "Brilliant", email: "..."}
      } else if (!from || from === 'Unknown sender') {
        from = extractFromFromPayload(email) || 'Unknown sender';
      }
      
      return {
        index: index + 1,
        subject: email.subject || extractSubjectFromPayload(email) || 'No subject',
        from: from,
        date: email.date || extractDateFromPayload(email) || 'Unknown date',
        snippet: email.snippet || email.bodyPreview || 'No preview available',
        // Extract the full email body content
        body: email.body_plain || email.body || email.content || '',
        isUnread: email.isUnread || false,
        fullDate: email.fullDate || email.date || 'Unknown date'
      };
    });
    
    // PHASE 5: Different prompts for single vs multiple emails
    let prompt;
    
    if (wantsSingleEmail && emailData.length === 1) {
      // Prompt optimized for single email responses
      const email = emailData[0];
      prompt = `You are an AI assistant helping to summarize a Gmail search result. The user asked: "${userQuery}"

Here is the most recent email found:

**${email.subject}**${email.isUnread ? ' • UNREAD' : ''}
From: ${email.from}
Date: ${email.fullDate}
${email.body ? `\nFull Content:\n${email.body}\n` : `Preview: ${email.snippet}`}

Please provide a focused summary that:
1. Clearly states this is the most recent email matching their request.
2. Highlights the key information from this specific email, including the actual content and any important details. The summary MUST explicitly state the email's subject line.
3. Mentions if this appears urgent or time-sensitive.
4. Suggests relevant next actions (read full email, reply, etc.).
5. Uses a conversational, helpful tone.
6. Keeps the response under 200 words.

Focus on being precise and actionable since they asked for their most recent email. Include specific details from the email content.`;
    } else {
      // Prompt for multiple emails
      prompt = `You are an AI assistant helping to summarize Gmail search results. The user asked: "${userQuery}"

Here are the ${emailData.length} most recent emails found:

${emailData.map(email => 
  `${email.index}. **${email.subject}**${email.isUnread ? ' • UNREAD' : ''}
   From: ${email.from}
   Date: ${email.fullDate}
   ${email.body ? `Content: ${email.body.substring(0, 200)}${email.body.length > 200 ? '...' : ''}` : `Preview: ${email.snippet}`}`
).join('\n\n')}

Please provide a concise, helpful summary that:
1. Highlights the most important/relevant emails based on the user's query. For each highlighted email, the summary MUST explicitly state its subject line.
2. Groups similar emails if applicable (e.g., newsletters, notifications, etc.).
3. Mentions any urgent or time-sensitive items.
4. Keeps the response under 300 words.
5. Uses a conversational, helpful tone.

Focus on what the user would find most useful given their original request.`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Using GPT-4o-mini for fast, cost-effective summarization
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 400,
        temperature: 0.3
        // Removed invalid 'timeout' parameter that was causing 400 error
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content;
    
    if (!summary) {
      throw new Error('No summary generated by GPT');
    }
    
    devLog.verbose('🔍 [GPT SUMMARY] Successfully generated summary');
    return summary;
    
  } catch (error) {
    devLog.verbose('🔍 [GPT SUMMARY] Error:', error);
    
    // Enhanced error logging
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        devLog.verbose('🔍 [GPT SUMMARY] Request timed out after 15 seconds');
      } else {
        devLog.verbose('🔍 [GPT SUMMARY] Error details:', error.message);
      }
    }
    
    // Fallback to basic formatting if GPT fails
    const basicSummary = `Found ${emails.length} email${emails.length !== 1 ? 's' : ''}:\n\n` +
      emails.slice(0, 5).map((email: any, index: number) => 
        `${index + 1}. **${email.subject}**\n   From: ${typeof email.from === 'object' && email.from?.email ? email.from.email : email.from}\n   Date: ${email.date}\n   Preview: ${email.snippet}`
      ).join('\n\n');
    
    return basicSummary;
  }
}

/* Gmail payload stripping function to reduce response size */
function stripGmailPayload(gmailResult: any): any {
  try {
    devLog.verbose('🔍 [STRIP DEBUG] ===== GMAIL PAYLOAD PROCESSING =====');
    devLog.verbose('🔍 [STRIP DEBUG] Initial gmailResult structure:', JSON.stringify(gmailResult, null, 2));
    
    // Debug logging (removed file system logging due to errors)
    
    if (gmailResult?.content?.[0]?.text) {
      devLog.verbose('🔍 [STRIP DEBUG] Found text content, parsing...');
      const parsed = JSON.parse(gmailResult.content[0].text);
      devLog.verbose('🔍 [STRIP DEBUG] Parsed structure:', JSON.stringify(parsed, null, 2));
      
      // Check if we have the execution.result structure from Zapier
      if (parsed.execution?.result && Array.isArray(parsed.execution.result)) {
        devLog.verbose('🔍 [STRIP DEBUG] Found execution.result structure with', parsed.execution.result.length, 'items');
        
        // Analyze each item in the result
        parsed.execution.result.forEach((item: any, index: number) => {
          devLog.verbose(`🔍 [STRIP DEBUG] Item ${index}:`, JSON.stringify(item, null, 2));
          devLog.verbose(`🔍 [STRIP DEBUG] Item ${index} _zap_search_was_found_status:`, item._zap_search_was_found_status);
          if (item.raw) {
            devLog.verbose(`🔍 [STRIP DEBUG] Item ${index} raw structure:`, JSON.stringify(item.raw, null, 2));
            if (item.raw.payload) {
              devLog.verbose(`🔍 [STRIP DEBUG] Item ${index} raw.payload structure:`, JSON.stringify(item.raw.payload, null, 2));
              if (item.raw.payload.headers) {
                devLog.verbose(`🔍 [STRIP DEBUG] Item ${index} headers:`, item.raw.payload.headers);
              }
            }
          }
        });
        const foundEmails = parsed.execution.result.filter((email: any) => 
          email._zap_search_was_found_status === true
        );
        
        devLog.verbose('🔍 [STRIP] Found emails:', foundEmails.length, 'out of', parsed.execution.result.length);
        
        if (foundEmails.length === 0) {
          // No emails found - return empty results
          parsed.results = [];
        } else {
          // PHASE 3: Implement result filtering for "most recent" queries
          devLog.verbose('🔍 [STRIP] Processing', foundEmails.length, 'found emails');
          
                     // Process found emails with enhanced extraction
           let processedEmails = foundEmails.map((email: any) => {
            // Try multiple payload locations for extraction
            const extractionPayload = email.raw?.payload || email.payload || email;
            
            // ENHANCED EXTRACTION: Try multiple approaches
            let subject = extractSubjectFromPayload(extractionPayload);
            let from = extractFromFromPayload(extractionPayload);
            let date = extractDateFromPayload(extractionPayload);
            let body = extractBodyFromPayload(extractionPayload);
            const labels = extractLabelsFromPayload(extractionPayload);
            
            // Check if email is unread
            const isUnread = labels.includes('UNREAD');
            
            // Fallback 1: Try direct email properties  
            if (!subject) {
              subject = email.subject || email.raw?.subject || email.snippet?.substring(0, 50) || 'No subject';
            }
            if (!from) {
              from = email.from || email.raw?.from || email.sender || 'Unknown sender';
            }
            if (!date) {
              date = email.date || email.raw?.date || email.timestamp || 'Unknown date';
            }
            
            // Fallback 2: Try common Zapier/Gmail properties
            if (!from || from === 'Unknown sender') {
              from = email.fromName || email.fromEmail || email.senderName || email.senderEmail || 'Unknown sender';
            }
            if (!date || date === 'Unknown date') {
              date = email.receivedTime || email.sentTime || email.dateTime || 'Unknown date';
            }
            
            // Try to get body from Zapier-specific fields
            if (!body) {
              body = email.body_plain || email.bodyPlain || email.textBody || null;
            }
            
            devLog.verbose('🔍 [STRIP] Final extracted values:', { subject, from, date, hasBody: !!body, labels });
            const snippet = email.raw?.snippet?.substring(0, 150) || 
                           email.snippet?.substring(0, 150) || 
                           'No preview';
            
            // PHASE 4: Additional data cleaning for snippets
            const cleanSnippet = snippet
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&nbsp;/g, ' ')
              .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove invisible Unicode characters
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim();
            
            // Generate preview from body if snippet is not meaningful
            const preview = generatePreviewFromBody(body, cleanSnippet);
            
            // Extract date for sorting (try to get actual timestamp)
            let sortableDate = null;
            let fullDateString = date;  // Default to formatted date
            
            if (email.raw?.internalDate) {
              sortableDate = new Date(parseInt(email.raw.internalDate));
            } else if (extractionPayload?.headers) {
              const dateHeader = extractionPayload.headers.find((h: any) => h.name?.toLowerCase() === 'date');
              if (dateHeader?.value) {
                sortableDate = new Date(dateHeader.value);
                fullDateString = dateHeader.value;  // Use the raw date string
              }
            }
            
            return {
              id: email.raw?.id || email.id || 'unknown_id',
              subject: subject,
              from: from,
              date: date,
              snippet: preview,  // Use the enhanced preview instead of just snippet
              sortableDate: sortableDate,
              isUnread: isUnread,
              labels: labels,
              bodyPreview: preview,  // Include separately for GPT to use
              fullDate: fullDateString  // Include full date string
            };
          });
          
                     // Sort by date descending (newest first) if we have sortable dates
           if (processedEmails.some((email: any) => email.sortableDate)) {
             processedEmails.sort((a: any, b: any) => {
               const dateA = a.sortableDate || new Date(0);
               const dateB = b.sortableDate || new Date(0);
               return dateB.getTime() - dateA.getTime();
             });
             devLog.verbose('🔍 [STRIP] Sorted emails by date (newest first)');
           }
          
          // Check if this was a "most recent" query and limit to 1 result
          // We'll check if _internal_most_recent flag was set in the params
          const wantsMostRecent = parsed.execution?.params?._internal_most_recent;
          
          if (wantsMostRecent && processedEmails.length > 1) {
            devLog.verbose('🔍 [STRIP] "Most recent" query detected, limiting to 1 email');
            processedEmails = processedEmails.slice(0, 1);
          }
          
                     // Remove the sortableDate before returning (keep internal structure clean)
           parsed.results = processedEmails.map(({sortableDate, ...email}: any) => email);
          
          devLog.verbose('🔍 [STRIP] Final processed emails count:', parsed.results.length);
        }
      } else if (parsed.results && Array.isArray(parsed.results)) {
        // Handle direct results array (different response format)
        parsed.results = parsed.results.filter((email: any) => {
          // Only keep emails that have actual data
          return email.id || email.subject || email.from || (email.snippet && email.snippet !== 'No preview');
        }).map((email: any) => {
          const body = extractBodyFromPayload(email);
          const labels = extractLabelsFromPayload(email);
          const isUnread = labels.includes('UNREAD');
          const preview = generatePreviewFromBody(body, email.snippet?.substring(0, 150));
          
          return {
            id: email.id || 'unknown_id',
            subject: email.subject || 'No subject',
            from: email.from || 'Unknown sender', 
            date: email.date || 'Unknown date',
            snippet: preview,
            isUnread: isUnread,
            labels: labels,
            bodyPreview: preview,
            fullDate: email.date || 'Unknown date'
          };
        });
      }
      
      gmailResult.content[0].text = JSON.stringify(parsed);
    }
    return gmailResult;
  } catch (e) {
    devLog.verbose('Gmail payload stripping failed:', e);
    return gmailResult;
  }
}