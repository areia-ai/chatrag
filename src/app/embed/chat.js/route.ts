import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import fs from 'fs';
import path from 'path';

// Force dynamic rendering - don't cache this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Read embed color with fallback for dev and production
function getEmbedColor(): string {
  // Production: check process.env first (Vercel sets this)
  if (process.env.NEXT_PUBLIC_EMBED_PRIMARY_COLOR) {
    return process.env.NEXT_PUBLIC_EMBED_PRIMARY_COLOR;
  }

  // Development: read from .env.local file (workaround for Next.js Turbopack caching)
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/NEXT_PUBLIC_EMBED_PRIMARY_COLOR=(.+)/);
      if (match) {
        return match[1].trim();
      }
    }
  } catch (e) {
    // Ignore file read errors
  }

  // Final fallback: check env singleton or use default
  return env.NEXT_PUBLIC_EMBED_PRIMARY_COLOR || '#FF6417';
}

export async function GET(request: NextRequest) {
  // Check if embed is enabled (also allow in demo mode)
  const isDemoMode = env.NEXT_PUBLIC_DEMO_MODE === 'true';
  if (env.NEXT_PUBLIC_EMBED_ENABLED !== 'true' && !isDemoMode) {
    return new NextResponse('Embed functionality is disabled', { status: 403 });
  }

  // Get the origin for API calls
  // Always use this server's origin so API requests go to the ChatRAG demo domain
  const origin = request.nextUrl.origin;

  // Get configuration from environment
  const faviconPath = env.NEXT_PUBLIC_FAVICON_URL || '/favicon.svg';
  const logoUrl = faviconPath.startsWith('http') ? faviconPath : `${origin}${faviconPath}`;

  const config = {
    title: env.NEXT_PUBLIC_EMBED_TITLE || 'ChatRAG Assistant',
    primaryColor: getEmbedColor(),
    position: env.NEXT_PUBLIC_EMBED_POSITION || 'bottom-right',
    autoOpen: env.NEXT_PUBLIC_EMBED_AUTO_OPEN === 'true',
    greeting: env.NEXT_PUBLIC_EMBED_GREETING || 'Hello! How can I help you today?',
    allowedDomains: env.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS || '*',
    requireAuth: env.EMBED_REQUIRE_AUTH === 'true',
    model: env.NEXT_PUBLIC_EMBED_MODEL || 'openai/gpt-4o-mini',
    suggestionsEnabled: env.NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED === 'true',
    logoUrl: logoUrl,
    suggestions: (() => {
      try {
        const suggestionsStr = env.NEXT_PUBLIC_EMBED_SUGGESTIONS;
        return suggestionsStr ? JSON.parse(suggestionsStr) : [
          'Who is the creator of ChatRAG?',
          'How much does ChatRAG cost and is it a one-time payment?',
          'Do I really own the chatbots I create or is there vendor lock-in?',
          'Can I build unlimited chatbots for my clients without extra fees?',
          'What vector database and AI models does ChatRAG use?',
          'How does ChatRAG compare to Chatbase in pricing and features?'
        ];
      } catch (e) {
        return [
          'Who is the creator of ChatRAG?',
          'How much does ChatRAG cost and is it a one-time payment?',
          'Do I really own the chatbots I create or is there vendor lock-in?',
          'Can I build unlimited chatbots for my clients without extra fees?',
          'What vector database and AI models does ChatRAG use?',
          'How does ChatRAG compare to Chatbase in pricing and features?'
        ];
      }
    })()
  };

  // Domain validation
  if (config.allowedDomains !== '*') {
    const allowedDomains = config.allowedDomains.split(',').map((d: string) => d.trim());
    const requestOrigin = request.headers.get('origin');

    if (requestOrigin) {
      const isAllowed = allowedDomains.some((domain: string) => {
        if (domain.startsWith('*.')) {
          // Wildcard subdomain matching
          const baseDomain = domain.substring(2);
          return requestOrigin.endsWith(baseDomain);
        }
        return requestOrigin.includes(domain);
      });

      if (!isAllowed) {
        return new NextResponse('Domain not allowed', { status: 403 });
      }
    }
  }

  // Generate the widget JavaScript
  const widgetScript = `
(function() {
  'use strict';
  
  // Enhanced markdown renderer with support for headers, lists, tables, bold, italic, code
  function escapeHtml(s){
    return s
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function renderMarkdown(text) {
    if (!text) return '';

    const lines = text.split('\\n');
    let html = '';
    let inCodeBlock = false;
    let codeBlockContent = '';
    let inTable = false;
    let tableRows = [];
    let inList = false;
    let listItems = [];
    let listType = '';

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Handle code blocks
      if (line.trim().startsWith('\`\`\`')) {
        if (inCodeBlock) {
          // Close code block
          html += '<pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0;"><code style="font-family:monospace;font-size:13px;white-space:pre;">' + escapeHtml(codeBlockContent.trim()) + '<\/code><\/pre>';
          codeBlockContent = '';
          inCodeBlock = false;
        } else {
          // Start code block
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent += line + '\\n';
        continue;
      }

      // Handle tables
      if (line.includes('|') && line.trim().startsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        tableRows.push(line);
        continue;
      } else if (inTable) {
        // End of table
        html += renderTable(tableRows);
        tableRows = [];
        inTable = false;
      }

      // Handle lists
      const listMatch = line.match(/^(\\s*)([-*]|\\d+\\.)\\s+(.+)$/);
      if (listMatch) {
        const currentListType = listMatch[2].match(/\\d+\\./) ? 'ol' : 'ul';

        if (!inList) {
          inList = true;
          listType = currentListType;
          listItems = [];
        } else if (listType !== currentListType) {
          // Close previous list and start new one
          html += \`<\${listType} style="margin:8px 0;padding-left:24px;">\`;
          listItems.forEach(item => {
            html += \`<li style="margin:4px 0;">\${processInlineMarkdown(item)}<\/li>\`;
          });
          html += \`</\${listType}>\`;
          listItems = [];
          listType = currentListType;
        }

        listItems.push(listMatch[3]);
        continue;
      } else if (inList) {
        // End of list
        html += \`<\${listType} style="margin:8px 0;padding-left:24px;">\`;
        listItems.forEach(item => {
          html += \`<li style="margin:4px 0;">\${processInlineMarkdown(item)}<\/li>\`;
        });
        html += \`</\${listType}>\`;
        listItems = [];
        inList = false;
        listType = '';
      }

      // Handle headers
      if (line.startsWith('### ')) {
        html += '<h3 style="font-size:16px;font-weight:600;margin:12px 0 8px 0;color:#333;">' + processInlineMarkdown(line.substring(4)) + '<\/h3>';
        continue;
      } else if (line.startsWith('## ')) {
        html += '<h2 style="font-size:18px;font-weight:600;margin:14px 0 8px 0;color:#333;">' + processInlineMarkdown(line.substring(3)) + '<\/h2>';
        continue;
      } else if (line.startsWith('# ')) {
        html += '<h1 style="font-size:20px;font-weight:600;margin:16px 0 8px 0;color:#333;">' + processInlineMarkdown(line.substring(2)) + '<\/h1>';
        continue;
      }

      // Handle empty lines
      if (line.trim() === '') {
        html += '<br>';
        continue;
      }

      // Regular paragraph
      html += '<div style="margin:4px 0;">' + processInlineMarkdown(line) + '<\/div>';
    }

    // Close any open blocks
    if (inCodeBlock) {
      html += '<pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0;"><code style="font-family:monospace;font-size:13px;">' + escapeHtml(codeBlockContent.trim()) + '<\/code><\/pre>';
    }
    if (inTable) {
      html += renderTable(tableRows);
    }
    if (inList) {
      html += \`<\${listType} style="margin:8px 0;padding-left:24px;">\`;
      listItems.forEach(item => {
        html += \`<li style="margin:4px 0;">\${processInlineMarkdown(item)}<\/li>\`;
      });
      html += \`</\${listType}>\`;
    }

    return html;
  }

  function renderTable(rows) {
    if (rows.length < 2) return '';

    let html = '<div style="overflow-x:auto;margin:12px 0;"><table style="border-collapse:collapse;width:100%;font-size:13px;background:white;border:1px solid #ddd;">';

    // Header row
    const headerCells = rows[0].split('|').filter(cell => cell.trim());
    html += '<thead><tr style="background:#f5f5f5;">';
    headerCells.forEach(cell => {
      html += \`<th style="border:1px solid #ddd;padding:8px;text-align:left;font-weight:600;">\${processInlineMarkdown(cell.trim())}<\/th>\`;
    });
    html += '<\/tr><\/thead>';

    // Skip separator row (row 1)
    html += '<tbody>';
    for (let i = 2; i < rows.length; i++) {
      const cells = rows[i].split('|').filter(cell => cell.trim());
      html += '<tr>';
      cells.forEach(cell => {
        html += \`<td style="border:1px solid #ddd;padding:8px;">\${processInlineMarkdown(cell.trim())}<\/td>\`;
      });
      html += '<\/tr>';
    }
    html += '<\/tbody><\/table><\/div>';

    return html;
  }

  function processInlineMarkdown(text) {
    // Process inline code first (to protect it from other formatting)
    const codeRegex = /\`([^\`]+)\`/g;
    const codePlaceholders = [];
    text = text.replace(codeRegex, (match, code) => {
      const placeholder = \`__CODE_\${codePlaceholders.length}__\`;
      codePlaceholders.push('<code style="background:#f5f5f5;padding:2px 6px;border-radius:3px;font-family:monospace;font-size:12px;">' + escapeHtml(code) + '<\/code>');
      return placeholder;
    });

    // Escape HTML
    text = escapeHtml(text);

    // Bold: **text** or __text__
    text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1<\/strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1<\/strong>');

    // Italic: *text* or _text_ (but not in middle of words)
    text = text.replace(/(^|\\s)\\*(.+?)\\*($|\\s)/g, '$1<em>$2<\/em>$3');
    text = text.replace(/(^|\\s)_(.+?)_($|\\s)/g, '$1<em>$2<\/em>$3');

    // Links
    const linkRegex = /https?:\\/\\/[^\\s<>"']+[^\\s<>"'.,!?;:()]/g;
    text = text.replace(linkRegex, (url) => {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#1e40af;text-decoration:underline;word-break:break-all;overflow-wrap:break-word;">' + url + '<\/a>';
    });

    // Restore code placeholders
    codePlaceholders.forEach((code, i) => {
      text = text.replace(\`__CODE_\${i}__\`, code);
    });

    return text;
  }

  function renderText(t){
    return renderMarkdown(t);
  }
  
  // Configuration
  const config = ${JSON.stringify(config)};
  const apiOrigin = '${origin}';
  
  // Read data attributes from script tag
  const currentScript = document.currentScript || document.querySelector('script[src*="/embed/chat.js"]');
  if (currentScript) {
    // Override config with data attributes if present
    const dataColor = currentScript.getAttribute('data-primary-color');
    const dataTitle = currentScript.getAttribute('data-title');
    const dataPosition = currentScript.getAttribute('data-position');
    const dataAutoOpen = currentScript.getAttribute('data-auto-open');
    const dataGreeting = currentScript.getAttribute('data-greeting');
    const dataModel = currentScript.getAttribute('data-model');
    const dataSuggestionsEnabled = currentScript.getAttribute('data-suggestions-enabled');
    const dataSuggestions = currentScript.getAttribute('data-suggestions');
    
    if (dataColor) config.primaryColor = dataColor;
    if (dataTitle) config.title = decodeURIComponent(dataTitle);
    if (dataPosition) config.position = dataPosition;
    if (dataAutoOpen) config.autoOpen = dataAutoOpen === 'true';
    if (dataGreeting) config.greeting = decodeURIComponent(dataGreeting);
    if (dataModel) config.model = dataModel;
    if (dataSuggestionsEnabled) config.suggestionsEnabled = dataSuggestionsEnabled === 'true';
    if (dataSuggestions) {
      try {
        config.suggestions = JSON.parse(decodeURIComponent(dataSuggestions));
      } catch (e) {
        console.warn('Failed to parse data-suggestions:', e);
      }
    }
  }
  
  // Prevent multiple instances
  if (window.ChatRAGWidget) {
    console.warn('ChatRAG Widget already loaded');
    return;
  }
  
  // Widget state
  let isOpen = false;
  let isMinimized = false;
  let messages = [];
  let isLoading = false;
  
  // Create widget container
  function createWidget() {
    // Check if widget already exists
    if (document.getElementById('chatrag-widget-container')) {
      console.warn('ChatRAG Widget already exists');
      return;
    }
    
    const container = document.createElement('div');
    container.id = 'chatrag-widget-container';
    container.setAttribute('data-chatrag-widget', 'true');
    container.style.cssText = \`
      position: fixed;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      \${getPositionStyles()}
    \`;
    
    // Create chat button
    const button = document.createElement('button');
    button.id = 'chatrag-widget-button';
    button.innerHTML = '💬';
    button.style.cssText = \`
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: \${config.primaryColor};
      color: white;
      border: none;
      font-size: 28px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: transform 0.2s, box-shadow 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    \`;
    
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.1)';
      button.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    });
    
    button.addEventListener('click', toggleChat);
    
    // Create chat window
    const chatWindow = document.createElement('div');
    chatWindow.id = 'chatrag-widget-window';
    chatWindow.style.cssText = \`
      position: absolute;
      width: 350px;
      max-width: calc(100vw - 32px);
      height: 500px;
      max-height: calc(100vh - 100px);
      max-height: calc(100dvh - 100px);
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      display: none;
      flex-direction: column;
      overflow: hidden;
      \${getChatWindowPosition()}
    \`;
    
    // Create chat header
    const header = document.createElement('div');
    header.style.cssText = \`
      background: \${config.primaryColor};
      color: white;
      padding: 16px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    \`;
    header.innerHTML = \`
      <div style="display: flex; align-items: center; gap: 8px;">
        \${config.logoUrl ? \`<img src="\${config.logoUrl}" alt="Logo" style="width: 24px; height: 24px; object-fit: contain;" onerror="this.style.display='none'" />\` : ''}
        <span>\${config.title}</span>
      </div>
      <button id="chatrag-close-btn" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">×</button>
    \`;
    
    // Create messages container
    const messagesContainer = document.createElement('div');
    messagesContainer.id = 'chatrag-messages';
    messagesContainer.style.cssText = \`
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      background: #f9f9f9;
      display: flex;
      flex-direction: column;
      gap: 12px;
    \`;

    // Top group (greeting + suggestions) rendered as part of the scrollable chat content
    const topGroup = document.createElement('div');
    topGroup.id = 'chatrag-top-group';
    topGroup.style.cssText = \`
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
    \`;
    messagesContainer.appendChild(topGroup);

    // Add initial greeting into the top group (so suggestions appear below)
    if (config.greeting) {
      const greetWrap = document.createElement('div');
      greetWrap.style.cssText = \`margin-bottom: 0;\`;
      const label = document.createElement('div');
      label.style.cssText = \`color:#666;font-size:12px;margin-bottom:4px;\`;
      label.textContent = 'Assistant';
      const bubble = document.createElement('div');
      bubble.style.cssText = \`
        display:inline-block;max-width:80%;padding:12px 16px;border-radius:18px;
        font-size:14px;line-height:1.4;background:#fff;color:#333;border:1px solid #eee;
        border-bottom-left-radius:4px;
      \`;
      bubble.innerHTML = renderText(config.greeting);
      greetWrap.appendChild(label);
      greetWrap.appendChild(bubble);
      topGroup.appendChild(greetWrap);
    }

    // Create suggestions row wrapper (right-aligned like user messages)
    const suggestionsRow = document.createElement('div');
    suggestionsRow.className = 'suggestions-row';
    suggestionsRow.style.cssText = \`
      width: 100%;
      display: flex;
      justify-content: flex-end;
      margin: 4px 0 8px;
    \`;
    topGroup.appendChild(suggestionsRow);

    // Create suggestions container inside the row
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.id = 'chatrag-suggestions';
    suggestionsContainer.style.cssText = \`
      width: fit-content;
      max-width: 80%;
      display: \${config.suggestionsEnabled ? 'flex' : 'none'};
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      background: transparent;
    \`;
    suggestionsRow.appendChild(suggestionsContainer);

    // Add suggestion pills
    config.suggestions.forEach((suggestion) => {
      const pill = document.createElement('button');
      pill.className = 'chatrag-suggestion-pill';
      pill.textContent = suggestion;
      pill.style.cssText = \`
        padding: 8px 14px;
        border-radius: 16px;
        border: 1px solid #ddd;
        background: white;
        color: #333;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: normal;
        word-break: break-word;
        text-align: right;
        line-height: 1.3;
        max-width: 280px;
        font-family: inherit;
      \`;
      
      // Hover effects
      pill.addEventListener('mouseenter', () => {
        pill.style.background = config.primaryColor;
        pill.style.color = 'white';
        pill.style.borderColor = config.primaryColor;
      });
      
      pill.addEventListener('mouseleave', () => {
        pill.style.background = 'white';
        pill.style.color = '#333';
        pill.style.borderColor = '#ddd';
      });
      
      // Click handler - auto-fill and send (keep suggestions visible)
      pill.addEventListener('click', () => {
        const input = document.getElementById('chatrag-input');
        if (input && !isLoading) {
          input.value = suggestion;
          // Auto-send the message
          sendMessage();
        }
      });
      
      suggestionsContainer.appendChild(pill);
    });
    
    // Create input container
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = \`
      padding: 16px;
      border-top: 1px solid #eee;
      background: white;
    \`;
    
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = \`
      display: flex;
      gap: 8px;
      align-items: flex-end;
    \`;
    
    const input = document.createElement('textarea');
    input.id = 'chatrag-input';
    input.placeholder = 'Type your message...';
    input.style.cssText = \`
      flex: 1;
      border: 1px solid #ddd;
      border-radius: 20px;
      padding: 12px 16px;
      resize: none;
      font-family: inherit;
      font-size: 16px;
      max-height: 100px;
      min-height: 40px;
      background: white;
      color: #333;
      -webkit-appearance: none;
    \`;
    
    const sendButton = document.createElement('button');
    sendButton.id = 'chatrag-send-btn';
    sendButton.innerHTML = '→';
    sendButton.style.cssText = \`
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: \${config.primaryColor};
      color: white;
      border: none;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;
    \`;
    
    // Event listeners
    header.querySelector('#chatrag-close-btn').addEventListener('click', toggleChat);
    sendButton.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });
    
    // Assemble the widget
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(sendButton);
    inputContainer.appendChild(inputWrapper);
    
    chatWindow.appendChild(header);
    chatWindow.appendChild(messagesContainer);
    chatWindow.appendChild(inputContainer);
    
    container.appendChild(button);
    container.appendChild(chatWindow);
    
    document.body.appendChild(container);
    

    
    // Auto-open if configured
    if (config.autoOpen) {
      setTimeout(() => {
        if (!isOpen) toggleChat();
      }, 2000);
    }
  }
  
  function getPositionStyles() {
    const positions = {
      'bottom-right': 'bottom: 20px; right: 20px;',
      'bottom-left': 'bottom: 20px; left: 20px;',
      'top-right': 'top: 20px; right: 20px;',
      'top-left': 'top: 20px; left: 20px;'
    };
    return positions[config.position] || positions['bottom-right'];
  }
  
  function getChatWindowPosition() {
    const positions = {
      'bottom-right': 'bottom: 80px; right: 0;',
      'bottom-left': 'bottom: 80px; left: 0;',
      'top-right': 'top: 80px; right: 0;',
      'top-left': 'top: 80px; left: 0;'
    };
    return positions[config.position] || positions['bottom-right'];
  }
  
  function toggleChat() {
    const chatWindow = document.getElementById('chatrag-widget-window');
    const button = document.getElementById('chatrag-widget-button');
    
    isOpen = !isOpen;
    
    if (isOpen) {
      chatWindow.style.display = 'flex';
      button.innerHTML = '−';
      scrollToBottom();
    } else {
      chatWindow.style.display = 'none';
      button.innerHTML = '💬';
    }
  }
  
  function addMessage(role, content) {
    const messagesContainer = document.getElementById('chatrag-messages');
    const messageDiv = document.createElement('div');
    
    const isUser = role === 'user';
    messageDiv.style.cssText = \`
      margin-bottom: 12px;
      \${isUser ? 'text-align: right;' : 'text-align: left;'}
    \`;
    
    // Add label
    const label = document.createElement('div');
    label.style.cssText = \`
      color: #666;
      font-size: 12px;
      margin-bottom: 4px;
    \`;
    label.textContent = isUser ? 'You' : 'Assistant';
    
    const bubble = document.createElement('div');
    bubble.style.cssText = \`
      display: inline-block;
      max-width: 80%;
      padding: 12px 16px;
      border-radius: 18px;
      font-size: 14px;
      line-height: 1.4;
      \${isUser 
        ? \`background: \${config.primaryColor}; color: white; border-bottom-right-radius: 4px;\`
        : 'background: white; color: #333; border: 1px solid #eee; border-bottom-left-radius: 4px;'
      }
    \`;
    bubble.innerHTML = renderText(content);
    
    messageDiv.appendChild(label);
    messageDiv.appendChild(bubble);
    messagesContainer.appendChild(messageDiv);
    
    messages.push({ role, content });
    scrollToBottom();
  }
  
  function scrollToBottom() {
    const messagesContainer = document.getElementById('chatrag-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
  
  function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatrag-messages');
    const typingDiv = document.createElement('div');
    typingDiv.id = 'chatrag-typing';
    typingDiv.style.cssText = \`
      margin-bottom: 12px;
      display: flex;
      justify-content: flex-start;
    \`;
    
    const bubble = document.createElement('div');
    bubble.style.cssText = \`
      padding: 12px 16px;
      border-radius: 18px;
      background: white;
      border: 1px solid #eee;
      border-bottom-left-radius: 4px;
      font-size: 14px;
      color: #666;
    \`;
    bubble.innerHTML = 'Typing<span style="animation: blink 1.4s infinite;">...</span>';
    
    // Add blinking animation
    const style = document.createElement('style');
    style.textContent = \`
      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
    \`;
    document.head.appendChild(style);
    
    typingDiv.appendChild(bubble);
    messagesContainer.appendChild(typingDiv);
    scrollToBottom();
  }
  
  function hideTypingIndicator() {
    const typing = document.getElementById('chatrag-typing');
    if (typing) {
      typing.remove();
    }
  }
  
  async function sendMessage() {
    const input = document.getElementById('chatrag-input');
    const sendButton = document.getElementById('chatrag-send-btn');
    const message = input.value.trim();
    if (!message || isLoading) return;
    
    // Add user message
    addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';
    
    // Show loading state
    isLoading = true;
    sendButton.style.opacity = '0.5';

    // Create assistant message bubble immediately with loading animation
    const messagesContainer = document.getElementById('chatrag-messages');
    const messageDiv = document.createElement('div');
    messageDiv.id = 'chatrag-assistant-response';
    messageDiv.style.cssText = \`margin-bottom: 12px;\`;

    // Add "Assistant" label
    const label = document.createElement('div');
    label.style.cssText = \`color: #666; font-size: 12px; margin-bottom: 4px;\`;
    label.textContent = 'Assistant';

    const bubble = document.createElement('div');
    bubble.id = 'chatrag-response-bubble';
    bubble.style.cssText = \`
      display: inline-block;
      max-width: 80%;
      padding: 16px 20px;
      border-radius: 18px;
      font-size: 14px;
      line-height: 1.4;
      background: white;
      color: #333;
      border: 1px solid #eee;
      border-bottom-left-radius: 4px;
    \`;

    // Add loading dots to bubble
    const loadingDots = document.createElement('div');
    loadingDots.id = 'chatrag-loading-dots';
    loadingDots.style.cssText = \`display: flex; align-items: center; gap: 6px;\`;

    // Create three bouncing dots with different colors
    const colors = ['#3B82F6', '#EAB308', '#F97316']; // blue, yellow, orange
    const delays = [0, 0.2, 0.4];

    colors.forEach((color, i) => {
      const dot = document.createElement('div');
      dot.style.cssText = \`
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: \${color};
        animation: chatrag-bounce 0.6s infinite;
        animation-delay: \${delays[i]}s;
      \`;
      loadingDots.appendChild(dot);
    });

    // Add bounce keyframes animation
    const styleId = 'chatrag-typing-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = \`
        @keyframes chatrag-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      \`;
      document.head.appendChild(style);
    }

    bubble.appendChild(loadingDots);
    messageDiv.appendChild(label);
    messageDiv.appendChild(bubble);
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();

    try {
      // Prepare messages for API
      const apiMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      const response = await fetch(\`\${apiOrigin}/api/embed/chat\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages,
          model: config.model
        })
      });
      
      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}\`);
      }
      
      // Handle streaming response (AI SDK format)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';

      // Flag to track if dots have been removed
      let dotsRemoved = false;

      const removeLoadingDots = () => {
        if (!dotsRemoved) {
          const loadingDotsElement = document.getElementById('chatrag-loading-dots');
          if (loadingDotsElement) {
            loadingDotsElement.remove();
          }
          dotsRemoved = true;
        }
      };
      
      console.log('Starting to read streaming response...');
      
      // Read the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream finished');
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        console.log('Received chunk:', chunk);
        
        // Split by lines and process each line
        const lines = chunk.split(/\\r?\\n/);
        console.log('Split into lines:', lines);
        
        for (let rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          
          console.log('Processing line:', line);
          
          try {
            // Handle AI SDK streaming format
            if (line.startsWith('0:')) {
              // Text content: 0:"content" - extract the quoted string
              const jsonPart = line.slice(2); // Remove "0:"
              console.log('Parsing JSON part:', jsonPart);
              const content = JSON.parse(jsonPart);
              console.log('Extracted content:', content);
              removeLoadingDots();
              assistantMessage += content;
              bubble.innerHTML = renderText(assistantMessage);
              scrollToBottom();
              console.log('Added content:', content);
            } else if (line.startsWith('3:')) {
              // Error message: 3:"error message"
              const jsonPart = line.slice(2); // Remove "3:"
              console.log('Error received:', jsonPart);
              try {
                const errorMessage = JSON.parse(jsonPart);
                console.error('API Error:', errorMessage);
                bubble.textContent = errorMessage;
                assistantMessage = errorMessage;
                // Don't continue processing after an error
                return;
              } catch (e) {
                console.error('Could not parse error:', e);
              }
            } else if (line.startsWith('data:')) {
              // Server-sent events format
              const data = line.slice(5).trimStart();
              if (data === '[DONE]') {
                console.log('Stream completed with [DONE]');
                break;
              }
              
              try {
                const parsed = JSON.parse(data);
                console.log('📦 SSE data:', JSON.stringify(parsed));
                console.log('🔍 Keys:', Object.keys(parsed || {}));
                console.log('🔍 Type:', parsed?.type, typeof parsed?.type);
                console.log('🔍 Delta:', parsed?.delta, typeof parsed?.delta);
                
                // Handle Vercel AI SDK event stream - more explicit
                if (parsed && typeof parsed === 'object') {
                  const eventType = parsed.type;
                  const deltaContent = parsed.delta;
                  
                  if (eventType === 'text-delta' && typeof deltaContent === 'string') {
                    removeLoadingDots();
                    assistantMessage += deltaContent;
                    bubble.innerHTML = renderText(assistantMessage);
                    scrollToBottom();
                    console.log('✅ AI SDK delta:', deltaContent);
                  } else if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                    const content = parsed.choices[0].delta.content;
                    removeLoadingDots();
                    assistantMessage += content;
                    bubble.innerHTML = renderText(assistantMessage);
                    scrollToBottom();
                    console.log('✅ OpenAI delta:', content);
                  } else {
                    console.log('⚠️ No match. Keys:', Object.keys(parsed));
                  }
                } else {
                  console.log('⚠️ Not an object:', typeof parsed);
                }
              } catch (e) {
                console.debug('Could not parse SSE data:', data);
                // Fallback string extractor for AI SDK delta lines without valid JSON
                try {
                  if (data.indexOf('"delta"') !== -1) {
                    let i = data.indexOf('"delta"');
                    i = data.indexOf(':', i);
                    if (i !== -1) {
                      // Skip possible spaces and opening quote
                      while (i + 1 < data.length && (data[i+1] === ' ')) i++;
                      if (i + 2 < data.length && data[i+1] === '"') {
                        let j = i + 2;
                        let out = '';
                        while (j < data.length) {
                          const ch = data[j];
                          if (ch === '"' && data[j-1] !== '\\\\') break;
                          out += ch;
                          j++;
                        }
                        if (out) {
                          removeLoadingDots();
                          assistantMessage += out;
                          bubble.innerHTML = renderText(assistantMessage);
                          scrollToBottom();
                          console.log('Added fallback delta:', out);
                        }
                      }
                    }
                  }
                } catch(_){}
              }
            } else {
              // Try other formats
              try {
              const parsed = JSON.parse(line);
              if (typeof parsed === 'string') {
                assistantMessage += parsed;
                bubble.innerHTML = renderText(assistantMessage);
                scrollToBottom();
                }
              } catch (e) {
                console.debug('Could not parse line as JSON:', line);
              }
            }
          } catch (e) {
            console.debug('Error parsing line:', line, e);
          }
        }
      }
      
      console.log('Final message:', assistantMessage);
      
      // Ensure message is displayed even if stream parsing had issues
      if (!assistantMessage.trim()) {
        bubble.textContent = 'Sorry, I received an empty response. Please try again.';
        console.warn('No content was extracted from the stream');
      }
      
      // Store the complete message
      if (assistantMessage.trim()) {
        messages.push({ role: 'assistant', content: assistantMessage });
      } else {
        // If no content was received, show error
        bubble.textContent = 'Sorry, I encountered an error. Please try again.';
        messages.push({ role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' });
      }
      
    } catch (error) {
      console.error('=== CHAT ERROR DETAILS ===');
      console.error('Error object:', error);
      console.error('Error message:', error.message);
      console.error('Error type:', error.constructor.name);
      console.error('Error stack:', error.stack);
      
      // Show more specific error messages based on the actual error
      let errorMessage = 'Sorry, I encountered an error. Please try again.';
      let debugInfo = '';
      
      if (error.message.includes('403')) {
        errorMessage = 'Access denied. Please check if the embed is properly configured.';
        debugInfo = 'HTTP 403 - Forbidden';
      } else if (error.message.includes('429')) {
        errorMessage = 'Too many requests. Please wait a moment and try again.';
        debugInfo = 'HTTP 429 - Rate Limited';
      } else if (error.message.includes('500')) {
        errorMessage = 'Server error. Please try again later.';
        debugInfo = 'HTTP 500 - Internal Server Error';
      } else if (error.message.includes('Network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
        debugInfo = 'Network Error';
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Failed to connect to the server. Please try again.';
        debugInfo = 'Fetch Error';
      } else {
        debugInfo = 'Unknown Error: ' + error.message;
      }
      
      console.log('=== ERROR SUMMARY ===');
      console.log('User-facing message:', errorMessage);
      console.log('Debug info:', debugInfo);
      console.log('========================');
      
      addMessage('assistant', errorMessage);
    } finally {
      isLoading = false;
      sendButton.style.opacity = '1';
    }
  }
  
  // Initialize widget when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
  
  // Expose widget API
  window.ChatRAGWidget = {
    open: () => {
      if (!isOpen) toggleChat();
    },
    close: () => {
      if (isOpen) toggleChat();
    },
    toggle: toggleChat,
    isOpen: () => isOpen,
    version: 'v2-debug-delta'
  };
  
  // Log version for debugging
  console.log('ChatRAG Widget loaded:', window.ChatRAGWidget.version);
})();
`;

  return new NextResponse(widgetScript, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
} 
