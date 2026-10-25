/**
 * Zapier MCP Server Query Patterns
 * Patterns for all Zapier-connected tools including Gmail, Google Calendar, and Google Drive
 */

import { McpServerPatternsBase, PatternCategory } from '../base';

export class ZapierPatterns extends McpServerPatternsBase {
  serverName = 'zapier';
  displayName = 'Zapier MCP';

  patterns: { [category: string]: PatternCategory } = {
    // Gmail: Find Email
    gmail_find: {
      patterns: [
        /fetch.*email/i,
        /find.*email/i,
        /get.*email/i,
        /retrieve.*email/i,
        /check.*email/i,
        /search.*email/i,
        /show.*email/i,
        /list.*email/i,
        /last.*email/i,
        /latest.*email/i,
        /recent.*email/i,
        /new.*email/i,
        /unread.*email/i,
        /my.*email/i,
        /email.*from/i,
        /inbox/i,
        /gmail.*search/i,
        /gmail.*find/i,
        /check.*inbox/i,
        /check.*mail/i,
        /view.*email/i,
        /read.*email/i,
        /email.*today/i,
        /yesterday.*email/i,
        /this week.*email/i,
      ],
      confidence: 0.95,
      examples: [
        'fetch my last 5 emails',
        'get emails from today',
        'find emails from john',
        'check my inbox',
        'show me recent emails',
        'list unread emails',
        'search for emails about meeting',
        'what emails did I get today?',
        'any new emails?',
        'retrieve latest messages'
      ],
      description: 'Finding and searching emails in Gmail'
    },

    // Gmail: Create Draft
    gmail_create_draft: {
      patterns: [
        /draft.*email/i,
        /create.*draft/i,
        /compose.*draft/i,
        /prepare.*email/i,
        /write.*draft/i,
        /start.*draft/i,
        /new.*draft/i,
        /save.*draft/i,
        /draft.*message/i,
        /prepare.*message/i,
        // Multi-step patterns
        /then.*draft.*email/i,
        /afterwards.*create.*draft/i,
        /next.*compose.*email/i,
        /use.*zapier.*draft/i,
        /use.*mcp.*create.*email/i,
        /create.*gmail.*draft/i,
      ],
      confidence: 0.9,
      examples: [
        'draft an email to john',
        'create a draft email',
        'compose a draft message',
        'prepare an email for later',
        'write a draft to the team',
        'start drafting an email',
        'then create a gmail draft',
        'afterwards draft an email',
        'use zapier to create a draft'
      ],
      description: 'Creating email drafts in Gmail'
    },

    // Gmail: Create Draft Reply
    gmail_draft_reply: {
      patterns: [
        /draft.*reply/i,
        /prepare.*reply/i,
        /draft.*response/i,
        /prepare.*response/i,
        /create.*draft.*reply/i,
        /compose.*reply.*draft/i,
        /draft.*answer/i,
        /prepare.*answer/i,
        /reply.*draft/i,
        /response.*draft/i,
      ],
      confidence: 0.9,
      examples: [
        'draft a reply to the last email',
        'prepare a response to john',
        'create a draft reply',
        'draft an answer to the client',
        'prepare reply for later'
      ],
      description: 'Creating draft replies to emails'
    },

    // Gmail: Reply to Email
    gmail_reply: {
      patterns: [
        /reply.*email/i,
        /respond.*email/i,
        /answer.*email/i,
        /send.*reply/i,
        /reply.*to/i,
        /respond.*to/i,
        /answer.*message/i,
        /reply.*back/i,
        /respond.*with/i,
        /email.*reply/i,
        /email.*response/i,
        /reply.*message/i,
        /write.*back/i,
        /get back to/i,
      ],
      confidence: 0.95,
      examples: [
        'reply to john\'s email',
        'respond to the last email',
        'answer the client email',
        'send a reply saying yes',
        'reply back with approval',
        'respond to the meeting request',
        'write back to sarah'
      ],
      description: 'Replying to emails in Gmail'
    },

    // Google Calendar: Find Event
    calendar_find: {
      patterns: [
        /check.*calendar/i,
        /view.*calendar/i,
        /show.*calendar/i,
        /calendar.*event/i,
        /upcoming.*event/i,
        /next.*meeting/i,
        /next.*appointment/i,
        /schedule.*today/i,
        /schedule.*tomorrow/i,
        /what.*calendar/i,
        /when.*meeting/i,
        /find.*event/i,
        /get.*event/i,
        /show.*event/i,
        /list.*event/i,
        /search.*calendar/i,
        /calendar.*schedule/i,
        /my.*schedule/i,
        /today.*schedule/i,
        /tomorrow.*schedule/i,
        /this week.*calendar/i,
        /next week.*calendar/i,
        /appointment/i,
        /upcoming.*appointment/i,
        /scheduled.*for/i,
        /what.*scheduled/i,
        /busy.*today/i,
        /free.*time/i,
      ],
      confidence: 0.9,
      examples: [
        'check my calendar',
        'what\'s on my calendar today?',
        'show tomorrow\'s schedule',
        'when is my next meeting?',
        'find events this week',
        'list upcoming appointments',
        'what\'s scheduled for Monday?',
        'check if I\'m free at 3pm',
        'view next week\'s calendar',
        'any meetings today?'
      ],
      description: 'Finding events and checking schedule in Google Calendar'
    },

    // Google Drive: Upload File
    drive_upload: {
      patterns: [
        /upload.*drive/i,
        /save.*drive/i,
        /store.*drive/i,
        /put.*drive/i,
        /add.*drive/i,
        /google.*drive.*upload/i,
        /google.*drive.*save/i,
        /google.*drive.*store/i,
        /google.*drive.*add/i,
        /upload.*google.*drive/i,
        /save.*google.*drive/i,
        /store.*google.*drive/i,
        /file.*to.*drive/i,
        /document.*to.*drive/i,
        /image.*to.*drive/i,
        /video.*to.*drive/i,
        /backup.*drive/i,
        /sync.*drive/i,
        /move.*to.*drive/i,
        /copy.*to.*drive/i,
        /transfer.*drive/i,
        // Add patterns for "this" references (after image generation)
        /upload.*this.*image.*drive/i,
        /upload.*this.*to.*drive/i,
        /save.*this.*to.*drive/i,
        /put.*this.*on.*drive/i,
        /upload.*it.*to.*drive/i,
        /save.*it.*to.*drive/i,
        /store.*this.*in.*drive/i,
        /add.*this.*to.*drive/i,
        /this.*image.*to.*drive/i,
        /this.*file.*to.*drive/i,
        /upload.*generated.*image/i,
        /save.*generated.*image/i,
        /upload.*that.*to.*drive/i,
        /save.*that.*to.*drive/i,
      ],
      confidence: 0.95,
      examples: [
        'upload this file to drive',
        'save document to google drive',
        'store this image in drive',
        'put the presentation on drive',
        'add this to my google drive',
        'backup files to drive',
        'move this to google drive',
        'upload the report to drive',
        'save all images to drive',
        'upload this image to google drive',
        'save this to my drive',
        'upload it to drive',
        'put this on google drive',
        'upload the generated image to drive'
      ],
      description: 'Uploading files to Google Drive'
    },

    // Generic Zapier MCP mentions
    zapier_explicit: {
      patterns: [
        /use.*zapier/i,
        /zapier.*mcp/i,
        /zapier.*tool/i,
        /zapier.*integration/i,
        /zapier.*action/i,
        // Multi-step patterns
        /then.*use.*zapier/i,
        /afterwards.*zapier/i,
        /next.*use.*mcp/i,
        /and then.*create.*email/i,
        /after that.*draft/i,
      ],
      confidence: 1.0,
      examples: [
        'use zapier mcp to fetch emails',
        'zapier mcp gmail search',
        'use zapier to check calendar',
        'zapier integration for drive',
        'then use zapier to create a draft',
        'and then create an email',
        'afterwards use the zapier MCP'
      ],
      description: 'Explicit Zapier MCP requests'
    }
  };

  /**
   * Override enabled check to also check for Zapier endpoint
   */
  enabled(): boolean {
    // First check parent enabled logic
    if (!super.enabled()) {
      return false;
    }

    // Also check if Zapier endpoint is configured
    const zapierEndpoint = process.env.MCP_ZAPIER_ENDPOINT;
    return !!zapierEndpoint && zapierEndpoint.length > 0;
  }
}

// Export singleton instance
export const zapierPatterns = new ZapierPatterns();