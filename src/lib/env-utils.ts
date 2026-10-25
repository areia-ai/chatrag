import fs from 'fs/promises';
import path from 'path';

/**
 * Updates a variable in the .env.local file
 * @param key The environment variable key to update
 * @param value The new value for the environment variable
 */
export async function updateEnvFile(key: string, value: string): Promise<void> {
  try {
    const envFilePath = path.join(process.cwd(), '.env.local');
    
    // Read the current content of the .env.local file
    const content = await fs.readFile(envFilePath, 'utf-8');
    
    // Check if the key already exists in the file
    const lines = content.split('\n');
    let updated = false;
    
    // Update the existing key if found
    const updatedLines = lines.map(line => {
      if (line.startsWith(`${key}=`) || line.startsWith(`${key} =`)) {
        updated = true;
        return `${key}=${value}`;
      }
      return line;
    });
    
    // If the key wasn't found, add it to the end
    if (!updated) {
      // Find the appropriate section based on the key
      let sectionFound = false;
      
      // Check if we should add to the BRANDING section
      if (key.startsWith('NEXT_PUBLIC_HEADER') || key.startsWith('NEXT_PUBLIC_AI_RESPONSE') || 
          key === 'NEXT_PUBLIC_FAVICON_URL' || key === 'NEXT_PUBLIC_SITE_TITLE') {
        const brandingSectionIndex = lines.findIndex(line => line.includes('# BRANDING'));
        if (brandingSectionIndex !== -1) {
          // Insert after the last entry in the branding section
          let insertIndex = brandingSectionIndex + 1;
          while (insertIndex < lines.length && 
                 !lines[insertIndex].trim().startsWith('#') && 
                 lines[insertIndex].trim() !== '') {
            insertIndex++;
          }
          
          updatedLines.splice(insertIndex, 0, `${key}=${value}`);
          sectionFound = true;
        }
      }
      
      // If no appropriate section was found, add to the end
      if (!sectionFound) {
        // Add a blank line if the file doesn't end with one
        if (updatedLines[updatedLines.length - 1] !== '') {
          updatedLines.push('');
        }
        updatedLines.push(`${key}=${value}`);
      }
    }
    
    // Write the updated content back to the file
    await fs.writeFile(envFilePath, updatedLines.join('\n'));
    
    console.log(`Updated ${key} in .env.local`);
  } catch (error) {
    console.error(`Error updating ${key} in .env.local:`, error);
    throw error;
  }
} 