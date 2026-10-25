import { ContentPart } from '@/types/chat';
import { marked } from 'marked';
import pdfMake from 'pdfmake/build/pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
// Import fonts directly to prevent runtime errors
import pdfFonts from 'pdfmake/build/vfs_fonts';

// Ensure fonts are loaded properly
// @ts-ignore TypeScript doesn't recognize the vfs property on pdfFonts
pdfMake.vfs = pdfFonts.pdfMake?.vfs;

// Process Markdown text for PDF formatting
const processMarkdown = (text: string): { title: string, content: string[][], tables: any[] } => {
  let title = "Chat Message";
  const sections: string[][] = [];
  const tables: any[] = [];
  
  // Clean up asterisks and other formatting markers from the text before processing
  const cleanedText = text
    .replace(/\*\*/g, '')  // Remove all double asterisks
    .replace(/\\/g, '')    // Remove backslashes
    .replace(/---/g, '')   // Remove horizontal rules
    .replace(/_{2,}/g, ''); // Remove underscores
    // Note: We don't remove vertical bars anymore since we need them for tables
  
  // Remove duplicate paragraphs (common issue with AI responses)
  const deduplicatedText = removeDuplicateParagraphs(cleanedText);
  
  // Convert markdown to HTML
  const tokens = marked.lexer(deduplicatedText);
  
  // Extract title from first heading if available
  let titleToken = null;
  if (tokens.length > 0 && tokens[0].type === 'heading' && tokens[0].depth === 1) {
    title = tokens[0].text;
    titleToken = tokens[0]; // Save the title token to skip it later
  }
  
  // Process tokens to create sections
  let currentSection: string[] = [];
  let currentHeading = '';
  let tableIndex = 0;
  
  // Helper function to detect and process simplified table formats (lines with multiple | characters)
  const processSimplifiedTable = (line: string): boolean => {
    // Check if this could be a simplified table row (contains multiple | characters)
    if (line.split('|').length > 3) {
      const strippedLine = line.trim();
      
      // Skip if it starts and ends with | but doesn't have enough content
      if (strippedLine.startsWith('|') && strippedLine.endsWith('|') && strippedLine.split('|').length < 4) {
        return false;
      }
      
      // Get existing table or create a new one for this simplified format
      const tableIdItem = currentSection.find(item => item.startsWith('[table-simple-'));
      let tableId = tableIdItem ? tableIdItem.substring(1, tableIdItem.length - 1) : undefined;
      let tableData;
      
      if (!tableId) {
        // Create a new table
        tableId = `table-simple-${tableIndex++}`;
        currentSection.push(`[${tableId}]`);
        
        // Create empty table structure
        tableData = {
          id: tableId,
          headers: [],
          rows: []
        };
        
        // Add to tables collection
        tables.push(tableData);
      } else {
        // Find existing table
        tableData = tables.find(t => t.id === tableId);
      }
      
      if (tableData) {
        // Process the row
        const cells = strippedLine.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell !== ''); // Remove empty cells
        
        // Add row to table
        tableData.rows.push(cells);
        
        return true;
      }
    }
    
    return false;
  }

  // Keep track of seen paragraphs within this content
  const seenParagraphs = new Set<string>();
  
  tokens.forEach(token => {
    // Skip the first H1 heading since we're using it as the document title
    if (token === titleToken) {
      return;
    }
    
    if (token.type === 'heading') {
      // Start a new section for each heading
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }
      
      currentSection = [];
      currentHeading = token.text;
      currentSection.push(`${'#'.repeat(token.depth)} ${token.text}`);
    } 
    else if (token.type === 'paragraph') {
      // Check if the paragraph contains simplified table format
      const paragraphText = token.text.replace(/\*\*/g, '');
      const lines = paragraphText.split('\n');
      
      let hasTableLines = false;
      
      // Process each line to see if it could be a simplified table
      lines.forEach((line: string) => {
        if (processSimplifiedTable(line)) {
          hasTableLines = true;
        } else {
          // If not a table line, check for duplicate before adding
          const normalizedLine = line.trim().toLowerCase();
          if (!seenParagraphs.has(normalizedLine)) {
            seenParagraphs.add(normalizedLine);
            currentSection.push(line);
          }
        }
      });
      
      // If we didn't find any table lines, add the whole paragraph back
      if (!hasTableLines && lines.length === 1) {
        const normalizedPara = paragraphText.trim().toLowerCase();
        if (!seenParagraphs.has(normalizedPara)) {
          seenParagraphs.add(normalizedPara);
          currentSection.push(paragraphText);
        }
      }
    }
    else if (token.type === 'list') {
      token.items.forEach((item: any) => {
        if (typeof item.text === 'string') {
          currentSection.push(`- ${item.text.replace(/\*\*/g, '')}`);
        }
      });
    }
    else if (token.type === 'space') {
      currentSection.push('');
    }
    else if (token.type === 'table') {
      // Handle standard markdown tables - add a placeholder to the section and store table data separately
      const tableId = `table-${tableIndex++}`;
      
      // Add table placeholder to the section
      currentSection.push(`[${tableId}]`);
      
      // Extract headers from table
      const headers = token.header.map((cell: any) => cell.text);
      
      // Extract rows from table
      const rows = token.rows.map((row: any[]) => 
        row.map((cell: any) => typeof cell === 'object' ? cell.text : String(cell))
      );
      
      // Store table data for later rendering
      tables.push({
        id: tableId,
        headers: headers,
        rows: rows
      });
    }
  });
  
  // Add the last section
  if (currentSection.length > 0) {
    sections.push(currentSection);
  }
  
  return { title, content: sections, tables };
};

// Function to remove duplicate paragraphs
const removeDuplicateParagraphs = (text: string): string => {
  const paragraphs = text.split('\n\n');
  const uniqueParagraphs: string[] = [];
  const seen = new Set<string>();
  
  paragraphs.forEach(paragraph => {
    // Normalize paragraph text to help with fuzzy matching
    const normalized = paragraph.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized.length > 20 && !seen.has(normalized)) {
      seen.add(normalized);
      uniqueParagraphs.push(paragraph);
    } else if (normalized.length <= 20) {
      // For short paragraphs, keep them (they might be headings, etc.)
      uniqueParagraphs.push(paragraph);
    }
  });
  
  return uniqueParagraphs.join('\n\n');
};

// Convert markdown sections to pdfmake content
const createPDFContent = (title: string, sections: string[][], tables: any[]): any[] => {
  // PDF content array
  const content: any[] = [];
  
  // Add title
  content.push({
    text: title,
    style: 'title',
    margin: [0, 0, 0, 20]
  });
  
  // Tracking already processed paragraphs within this function too
  const processedContent = new Set<string>();
  
  // Process each section
  sections.forEach(section => {
    section.forEach(line => {
      // For non-headings and non-tables, check for duplicates
      const isRegularContent = !line.startsWith('#') && !line.startsWith('[table-') && !line.startsWith('-');
      
      if (isRegularContent) {
        const normalizedLine = line.trim().toLowerCase();
        if (processedContent.has(normalizedLine)) {
          // Skip this line as it's a duplicate
          return;
        }
        processedContent.add(normalizedLine);
      }
      
      if (line.startsWith('# ')) {
        // H1 heading
        content.push({
          text: line.substring(2),
          style: 'h1',
          margin: [0, 15, 0, 10]
        });
      } 
      else if (line.startsWith('## ')) {
        // H2 heading
        content.push({
          text: line.substring(3),
          style: 'h2',
          margin: [0, 12, 0, 8]
        });
      }
      else if (line.startsWith('### ')) {
        // H3 heading
        content.push({
          text: line.substring(4),
          style: 'h3',
          margin: [0, 10, 0, 5]
        });
      }
      else if (line.startsWith('#### ')) {
        // H4 heading
        content.push({
          text: line.substring(5),
          style: 'h4',
          margin: [0, 8, 0, 5]
        });
      }
      else if (line.startsWith('- ')) {
        // Bullet point with proper indentation
        content.push({
          ul: [line.substring(2)],
          margin: [15, 5, 0, 5]  // Left margin increased to 15 for indentation
        });
      }
      else if (line.startsWith('[table-')) {
        // Table placeholder - find and render the actual table
        const tableId = line.substring(1, line.length - 1);
        const tableData = tables.find(t => t.id === tableId);
        
        if (tableData) {
          try {
            // Prepare table body
            const body: string[][] = [];
            
            // Check if we should use the first row as a header
            let firstRowAsHeader = false;
            
            // Add headers if available
            if (tableData.headers && tableData.headers.length > 0) {
              body.push(tableData.headers);
              firstRowAsHeader = true;
            } 
            // Auto-detect header from first row if it looks like headers (all caps, no numbers)
            else if (tableData.rows && tableData.rows.length > 0) {
              const firstRow = tableData.rows[0];
              // Check if first row contains text that looks like headers
              const looksLikeHeaders = firstRow.some((cell: string) => {
                const text = String(cell).trim();
                // Headers are often capitalized and not just numbers
                return text.toUpperCase() === text && /[A-Z]/.test(text) && !/^\d+(\.\d+)?$/.test(text);
              });
              
              if (looksLikeHeaders) {
                body.push(firstRow);
                firstRowAsHeader = true;
                // Skip this row when adding data rows later
                tableData.rows = tableData.rows.slice(1);
              }
            }
            
            // Get max column count for all rows
            const maxColumns = Math.max(
              body.length > 0 ? body[0].length : 0,
              ...tableData.rows.map((row: string[]) => row.length)
            );
            
            // Add rows (ensure they have the same number of columns)
            if (tableData.rows && tableData.rows.length > 0) {
              // Add rows with padding if needed
              tableData.rows.forEach((row: string[]) => {
                // Make sure the row isn't empty or just dashes (separator rows)
                if (row.length === 0 || row.every(cell => cell === '' || cell === '-' || cell === '--')) {
                  return; // Skip empty or separator rows
                }
                
                if (row.length < maxColumns) {
                  // Pad row with empty cells if needed
                  body.push([...row, ...Array(maxColumns - row.length).fill('')]);
                } else {
                  body.push(row);
                }
              });
            }
            
            // Skip if no valid rows found
            if (body.length === 0) {
              content.push({
                text: '[Table has no data]',
                style: 'tableError',
                margin: [0, 5, 0, 5]
              });
              return;
            }
            
            // Add table to content
            content.push({
              table: {
                headerRows: firstRowAsHeader ? 1 : 0,
                widths: Array(maxColumns).fill('*'), // Equal width columns
                body: body
              },
              layout: {
                hLineWidth: (i: number) => 0.5,
                vLineWidth: (i: number) => 0.5,
                hLineColor: (i: number) => '#dddddd',
                vLineColor: (i: number) => '#dddddd',
                fillColor: (rowIndex: number) => {
                  return (rowIndex === 0 && firstRowAsHeader) ? '#f5f5f5' : (rowIndex % 2 === 0 ? '#ffffff' : '#fbfbfb');
                },
              },
              style: 'table',
              margin: [0, 10, 0, 15]
            });
          } catch (error) {
            // Error handling - add error text
            content.push({
              text: `[Table could not be rendered - Error: ${(error as Error).message}]`,
              style: 'tableError',
              margin: [0, 5, 0, 5]
            });
          }
        } else {
          // Table not found - add placeholder text
          content.push({
            text: `[Table could not be rendered - ID: ${tableId}]`,
            style: 'tableError',
            margin: [0, 5, 0, 5]
          });
        }
      }
      else if (line.trim() !== '') {
        // Regular paragraph
        content.push({
          text: line,
          style: 'paragraph',
          margin: [0, 5, 0, 5]
        });
      }
      else {
        // Empty line - add small space
        content.push({
          text: '',
          margin: [0, 4, 0, 0]
        });
      }
    });
    
    // Add space after section
    content.push({
      text: '',
      margin: [0, 8, 0, 0]
    });
  });
  
  return content;
};

// Generate a PDF blob from a message
export const generatePDFBlob = async (role: 'user' | 'assistant', content: string | ContentPart[]): Promise<Blob> => {
  // Extract text from content
  const messageText = Array.isArray(content)
    ? content.map(part => {
        if (part.type === 'text') return part.text || '';
        if (part.type === 'image_url') return `[Image]`;
        if (part.type === 'document') return `[Document: ${part.document?.name || ''}]`;
        return '';
      }).join('\n')
    : content;
  
  // Process markdown
  const { title, content: sections, tables } = processMarkdown(messageText);
  
  // Format the date for the timestamp
  const today = new Date();
  const formattedDate = `Generated: ${today.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' })}, ${today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${today.toLocaleTimeString('en-US').slice(-2)}`;
  
  // Get PDF content
  const pdfContent = createPDFContent(title, sections, tables);
  
  // Create PDF document definition with proper typing
  const docDefinition: TDocumentDefinitions = {
    content: pdfContent,
    // Add timestamp to the footer in bottom right
    footer: (currentPage, pageCount) => {
      return [
        { 
          text: `Page ${currentPage} of ${pageCount}`,
          style: 'footer',
          alignment: 'center',
          margin: [0, 0, 0, 0]
        },
        {
          text: formattedDate,
          style: 'timestamp',
          alignment: 'right',
          margin: [0, 0, 40, 0] // right margin
        }
      ];
    },
    styles: {
      title: {
        fontSize: 24,
        bold: true,
        color: '#000000'
      },
      timestamp: {
        fontSize: 10,
        color: '#666666',
        italics: true
      },
      h1: {
        fontSize: 20,
        bold: true,
        color: '#000000'
      },
      h2: {
        fontSize: 18,
        bold: true,
        color: '#000000'
      },
      h3: {
        fontSize: 16,
        bold: true,
        color: '#000000'
      },
      h4: {
        fontSize: 14,
        bold: true,
        color: '#000000'
      },
      paragraph: {
        fontSize: 12,
        margin: [0, 5, 0, 5]
      },
      table: {
        fontSize: 10,
        margin: [0, 8, 0, 8]
      },
      tableError: {
        fontSize: 10,
        italics: true,
        color: '#666666',
        margin: [0, 5, 0, 5]
      },
      footer: {
        fontSize: 10,
        color: '#666666'
      }
    },
    defaultStyle: {
      fontSize: 12
    },
    pageMargins: [40, 40, 40, 60],
  };
  
  // Create PDF
  const pdfDoc = pdfMake.createPdf(docDefinition);
  
  // Return as blob
  return new Promise((resolve) => {
    pdfDoc.getBlob((blob: Blob) => {
      resolve(blob);
    });
  });
};

// Generate a PDF filename
export const generatePDFFilename = (content: string | ContentPart[]): string => {
  let prefix = "Chat Message";
  
  // Get first few characters of content for filename
  if (typeof content === 'string') {
    const matches = content.match(/^#\s*(.*?)$/m);
    if (matches && matches[1]) {
      // Clean any formatting characters from the title
      prefix = matches[1].trim().replace(/[\*\\_]/g, '');
    } else {
      prefix = content.slice(0, 20).replace(/\W+/g, '-');
    }
  } else if (Array.isArray(content) && content.length > 0) {
    const firstPart = content[0];
    if (firstPart.type === 'text' && firstPart.text) {
      const matches = firstPart.text.match(/^#\s*(.*?)$/m);
      if (matches && matches[1]) {
        // Clean any formatting characters from the title
        prefix = matches[1].trim().replace(/[\*\\_]/g, '');
      } else {
        prefix = firstPart.text.slice(0, 20).replace(/\W+/g, '-');
      }
    }
  }
  
  // Clean the prefix and limit its length
  prefix = prefix.replace(/\W+/g, '-').slice(0, 30);
  
  // Add timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  return `${prefix}-${timestamp}.pdf`;
};

// Download PDF from a message
export const downloadMessageAsPDF = async (role: 'user' | 'assistant', content: string | ContentPart[]): Promise<void> => {
  const pdfBlob = await generatePDFBlob(role, content);
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = generatePDFFilename(content);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}; 