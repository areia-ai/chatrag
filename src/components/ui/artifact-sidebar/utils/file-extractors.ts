import { ReactNode } from 'react';
import { FileToDownload, FileType, SupportedLanguage } from '../types/artifact.types';
import { FileText, FileCode, FileJson, Image, File } from 'lucide-react';

function getFileIcon(type: FileType): ReactNode {
  const iconSize = 16;
  switch (type) {
    case 'html':
      return FileText({ size: iconSize });
    case 'css':
      return FileCode({ size: iconSize });
    case 'js':
      return FileCode({ size: iconSize });
    case 'json':
      return FileJson({ size: iconSize });
    case 'svg':
      return Image({ size: iconSize });
    default:
      return File({ size: iconSize });
  }
}

function getFileExtensionFromLanguage(language: SupportedLanguage): string {
  const extensions: Record<SupportedLanguage, string> = {
    html: 'html',
    css: 'css',
    js: 'js',
    javascript: 'js',
    jsx: 'jsx',
    tsx: 'tsx',
    svg: 'svg',
    json: 'json',
    markdown: 'md',
    yaml: 'yml',
    xml: 'xml',
    python: 'py',
    bash: 'sh',
    shell: 'sh',
  };
  
  return extensions[language] || 'txt';
}

function getMimeType(type: FileType): string {
  const mimeTypes: Record<FileType, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    txt: 'text/plain',
  };
  
  return mimeTypes[type] || 'text/plain';
}

function extractScriptContent(htmlCode: string): string[] {
  const scripts: string[] = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  
  while ((match = scriptRegex.exec(htmlCode)) !== null) {
    const scriptContent = match[1].trim();
    if (scriptContent) {
      scripts.push(scriptContent);
    }
  }
  
  return scripts;
}

function extractStyleContent(htmlCode: string): string[] {
  const styles: string[] = [];
  const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  
  while ((match = styleTagRegex.exec(htmlCode)) !== null) {
    const styleContent = match[1].trim();
    if (styleContent) {
      styles.push(styleContent);
    }
  }
  
  return styles;
}

function extractLinkedStyles(htmlCode: string): string[] {
  const linkedStyles: string[] = [];
  const linkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
  let match;
  
  while ((match = linkRegex.exec(htmlCode)) !== null) {
    linkedStyles.push(match[0]);
  }
  
  return linkedStyles;
}

function extractLinkedScripts(htmlCode: string): string[] {
  const linkedScripts: string[] = [];
  const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
  let match;
  
  while ((match = scriptRegex.exec(htmlCode)) !== null) {
    linkedScripts.push(match[1]);
  }
  
  return linkedScripts;
}

function calculateFileSize(content: string): number {
  return new Blob([content]).size;
}

export function extractFilesFromHTML(htmlCode: string): FileToDownload[] {
  const files: FileToDownload[] = [];
  
  // Always add the main HTML file
  files.push({
    name: 'index.html',
    content: htmlCode,
    type: 'html',
    icon: getFileIcon('html'),
    size: calculateFileSize(htmlCode),
  });
  
  // Extract and combine CSS
  const styleContents = extractStyleContent(htmlCode);
  if (styleContents.length > 0) {
    const combinedCss = styleContents.join('\n\n/* ===== Next Style Block ===== */\n\n');
    files.push({
      name: 'styles.css',
      content: combinedCss,
      type: 'css',
      icon: getFileIcon('css'),
      size: calculateFileSize(combinedCss),
    });
  }
  
  // Extract and combine JavaScript
  const scriptContents = extractScriptContent(htmlCode);
  if (scriptContents.length > 0) {
    const combinedJs = scriptContents.join('\n\n/* ===== Next Script Block ===== */\n\n');
    files.push({
      name: 'script.js',
      content: combinedJs,
      type: 'js',
      icon: getFileIcon('js'),
      size: calculateFileSize(combinedJs),
    });
  }
  
  return files;
}

export function createSingleFile(
  code: string, 
  language: SupportedLanguage, 
  customName?: string
): FileToDownload {
  const extension = getFileExtensionFromLanguage(language);
  const name = customName || `code.${extension}`;
  const type = (['html', 'css', 'js', 'json', 'svg'].includes(extension) 
    ? extension 
    : 'txt') as FileType;
  
  return {
    name,
    content: code,
    type,
    icon: getFileIcon(type),
    size: calculateFileSize(code),
  };
}

export function generateProjectFiles(
  code: string,
  language: SupportedLanguage,
  options: {
    includePackageJson?: boolean;
    includeReadme?: boolean;
    projectName?: string;
  } = {}
): FileToDownload[] {
  const files: FileToDownload[] = [];
  const { includePackageJson, includeReadme, projectName = 'my-project' } = options;
  
  // Add main file
  if (language === 'html') {
    files.push(...extractFilesFromHTML(code));
  } else {
    files.push(createSingleFile(code, language));
  }
  
  // Add package.json for JavaScript projects
  if (includePackageJson && ['js', 'jsx', 'tsx'].includes(language)) {
    const packageJson = {
      name: projectName,
      version: '1.0.0',
      description: 'Generated from ChatRAG artifact',
      main: 'index.js',
      scripts: {
        start: 'node index.js',
        dev: 'node index.js',
      },
      dependencies: {},
      devDependencies: {},
    };
    
    files.push({
      name: 'package.json',
      content: JSON.stringify(packageJson, null, 2),
      type: 'json',
      icon: getFileIcon('json'),
      size: calculateFileSize(JSON.stringify(packageJson, null, 2)),
    });
  }
  
  // Add README.md
  if (includeReadme) {
    const readmeContent = `# ${projectName}

Generated from ChatRAG artifact.

## Language
${language.toUpperCase()}

## Generated
${new Date().toISOString()}

## Usage
Open the main file in your preferred editor or browser.
`;
    
    files.push({
      name: 'README.md',
      content: readmeContent,
      type: 'txt',
      icon: getFileIcon('txt'),
      size: calculateFileSize(readmeContent),
    });
  }
  
  return files;
}

export function createDownloadBlob(content: string, mimeType: string): Blob {
  return new Blob([content], { type: mimeType });
}

export function triggerDownload(
  filename: string, 
  content: string, 
  mimeType: string
): void {
  const blob = createDownloadBlob(content, mimeType);
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function downloadFile(file: FileToDownload): void {
  const mimeType = getMimeType(file.type);
  triggerDownload(file.name, file.content, mimeType);
}

export function downloadMultipleFiles(files: FileToDownload[]): void {
  files.forEach((file, index) => {
    // Stagger downloads slightly to avoid browser blocking
    setTimeout(() => downloadFile(file), index * 100);
  });
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Validate file content
export function validateFileContent(content: string, type: FileType): boolean {
  try {
    switch (type) {
      case 'json':
        JSON.parse(content);
        return true;
      case 'html':
        // Basic HTML validation - check for valid structure
        return content.trim().length > 0;
      case 'css':
        // Basic CSS validation - check for valid structure
        return content.trim().length > 0;
      case 'js':
        // Basic JS validation - check for valid structure
        return content.trim().length > 0;
      default:
        return content.trim().length > 0;
    }
  } catch {
    return false;
  }
} 