import { SupportedLanguage, PreviewResult, PreviewError } from '../types/artifact.types';

const DEFAULT_STYLES = `
  html.light {
    color-scheme: light;
  }
  body { 
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 20px;
    line-height: 1.5;
    background-color: white;
    color: #333;
  }
`;

const SANDBOX_PERMISSIONS = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
].join(' ');

function createError(type: PreviewError['type'], message: string, recoverable = true): PreviewError {
  return {
    type,
    message,
    recoverable,
  };
}

function sanitizeHtml(html: string): string {
  // Basic HTML sanitization - remove dangerous tags and attributes
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}

function generateHtmlPreview(code: string, sanitize = true): PreviewResult {
  try {
    const processedCode = sanitize ? sanitizeHtml(code) : code;
    
    // Check if it's a complete HTML document
    const isCompleteDocument = /<!DOCTYPE\s+html|<html[\s>]/i.test(processedCode);
    
    const content = isCompleteDocument 
      ? processedCode
      : `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>${DEFAULT_STYLES}</style>
</head>
<body>
  ${processedCode}
</body>
</html>`;

    return {
      content,
      type: 'html',
      language: 'html',
      generatedAt: new Date(),
    };
  } catch (error) {
    return {
      content: '',
      type: 'error',
      language: 'html',
      generatedAt: new Date(),
      error: createError('generation', `Failed to generate HTML preview: ${error}`),
    };
  }
}

function generateCssPreview(code: string): PreviewResult {
  try {
    const content = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSS Preview</title>
  <style>
    ${DEFAULT_STYLES}
    
    /* Demo elements for CSS preview */
    .demo-container {
      max-width: 800px;
      margin: 0 auto;
    }
    
    .demo-elements {
      display: grid;
      gap: 1rem;
      margin-top: 2rem;
    }
    
    .demo-card {
      padding: 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
    }
  </style>
  <style>
    /* User CSS */
    ${code}
  </style>
</head>
<body>
  <div class="demo-container">
    <h1>CSS Preview</h1>
    <p>This is a preview of your CSS code with sample elements.</p>
    
    <div class="demo-elements">
      <div class="demo-card">
        <h2>Card Title</h2>
        <p>This is a sample card to demonstrate your CSS styles.</p>
        <button type="button">Button Example</button>
      </div>
      
      <div class="box">
        <span>Styled Box</span>
      </div>
      
      <form>
        <input type="text" placeholder="Input field" />
        <textarea placeholder="Textarea"></textarea>
        <select>
          <option>Option 1</option>
          <option>Option 2</option>
        </select>
      </form>
      
      <ul>
        <li>List item 1</li>
        <li>List item 2</li>
        <li>List item 3</li>
      </ul>
    </div>
  </div>
</body>
</html>`;

    return {
      content,
      type: 'html',
      language: 'css',
      generatedAt: new Date(),
    };
  } catch (error) {
    return {
      content: '',
      type: 'error',
      language: 'css',
      generatedAt: new Date(),
      error: createError('generation', `Failed to generate CSS preview: ${error}`),
    };
  }
}

function generateSvgPreview(code: string): PreviewResult {
  try {
    const content = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Preview</title>
  <style>
    ${DEFAULT_STYLES}
    body { 
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background-color: white;
    }
    .svg-container {
      max-width: 100%;
      max-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div class="svg-container">
    ${code}
  </div>
</body>
</html>`;

    return {
      content,
      type: 'html',
      language: 'svg',
      generatedAt: new Date(),
    };
  } catch (error) {
    return {
      content: '',
      type: 'error',
      language: 'svg',
      generatedAt: new Date(),
      error: createError('generation', `Failed to generate SVG preview: ${error}`),
    };
  }
}

function generateJsxPreview(code: string): PreviewResult {
  try {
    const content = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JSX Preview</title>
  <style>${DEFAULT_STYLES}</style>
</head>
<body>
  <div id="root">${code}</div>
  <script>
    // Note: This is a simplified JSX preview
    // In a real implementation, you would use Babel to transform JSX
    console.log('JSX Preview - Code rendered as HTML');
  </script>
</body>
</html>`;

    return {
      content,
      type: 'html',
      language: 'jsx',
      generatedAt: new Date(),
    };
  } catch (error) {
    return {
      content: '',
      type: 'error',
      language: 'jsx',
      generatedAt: new Date(),
      error: createError('generation', `Failed to generate JSX preview: ${error}`),
    };
  }
}

function generateJsonPreview(code: string): PreviewResult {
  try {
    // Validate JSON first
    const parsed = JSON.parse(code);
    const formatted = JSON.stringify(parsed, null, 2);
    
    const content = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JSON Preview</title>
  <style>
    ${DEFAULT_STYLES}
    .json-container {
      max-width: 800px;
      margin: 0 auto;
    }
    .json-viewer {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 1rem;
      overflow-x: auto;
    }
    .json-code {
      font-family: 'Monaco', 'Courier New', monospace;
      white-space: pre;
      margin: 0;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="json-container">
    <h1>JSON Preview</h1>
    <div class="json-viewer">
      <pre class="json-code">${formatted}</pre>
    </div>
  </div>
</body>
</html>`;

    return {
      content,
      type: 'html',
      language: 'json',
      generatedAt: new Date(),
    };
  } catch (error) {
    return {
      content: '',
      type: 'error',
      language: 'json',
      generatedAt: new Date(),
      error: createError('generation', `Invalid JSON: ${error}`, true),
    };
  }
}

function generateMarkdownPreview(code: string): PreviewResult {
  try {
    // Simple markdown to HTML conversion (basic implementation)
    const htmlContent = code
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)$/, '<p>$1</p>');

    const content = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Preview</title>
  <style>
    ${DEFAULT_STYLES}
    .markdown-container {
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.6;
    }
    .markdown-container h1, .markdown-container h2, .markdown-container h3 {
      margin-top: 2rem;
      margin-bottom: 1rem;
    }
    .markdown-container p {
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="markdown-container">
    ${htmlContent}
  </div>
</body>
</html>`;

    return {
      content,
      type: 'html',
      language: 'markdown',
      generatedAt: new Date(),
    };
  } catch (error) {
    return {
      content: '',
      type: 'error',
      language: 'markdown',
      generatedAt: new Date(),
      error: createError('generation', `Failed to generate Markdown preview: ${error}`),
    };
  }
}

function generateFallbackPreview(code: string, language: SupportedLanguage): PreviewResult {
  const content = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    ${DEFAULT_STYLES}
    body { 
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background-color: white;
      color: #333;
      text-align: center;
      padding: 20px;
    }
    .preview-info {
      max-width: 500px;
    }
    .code-snippet {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      text-align: left;
      overflow-x: auto;
      max-height: 200px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="preview-info">
    <h2>Preview not available for ${language.toUpperCase()} code</h2>
    <p>Live preview is available for HTML, CSS, SVG, JSON, and Markdown code.</p>
    <p>Here's your code:</p>
    <div class="code-snippet">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
</body>
</html>`;

  return {
    content,
    type: 'html',
    language,
    generatedAt: new Date(),
  };
}

export function generatePreview(
  code: string, 
  language: SupportedLanguage,
  options: { sanitize?: boolean } = {}
): PreviewResult {
  if (!code.trim()) {
    return {
      content: '',
      type: 'error',
      language,
      generatedAt: new Date(),
      error: createError('generation', 'No code provided', true),
    };
  }

  switch (language) {
    case 'html':
      return generateHtmlPreview(code, options.sanitize);
    case 'css':
      return generateCssPreview(code);
    case 'svg':
      return generateSvgPreview(code);
    case 'jsx':
    case 'tsx':
      return generateJsxPreview(code);
    case 'json':
      return generateJsonPreview(code);
    case 'markdown':
      return generateMarkdownPreview(code);
    default:
      return generateFallbackPreview(code, language);
  }
}

export { SANDBOX_PERMISSIONS }; 