import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { writeFile } from 'fs/promises';
import { updateEnvFile } from '@/lib/env-utils';

// This route is used by the config UI to upload logo files
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const logoFile = formData.get('logoFile') as File;
    const logoType = formData.get('logoType') as string;
    
    if (!logoFile || !logoType) {
      return NextResponse.json(
        { success: false, error: 'Missing file or logo type' },
        { status: 400 }
      );
    }
    
    // Validate logo type
    if (logoType !== 'header' && logoType !== 'ai') {
      return NextResponse.json(
        { success: false, error: 'Invalid logo type' },
        { status: 400 }
      );
    }
    
    // Validate file type
    const fileType = logoFile.name.split('.').pop()?.toLowerCase();
    if (fileType !== 'svg' && fileType !== 'png') {
      return NextResponse.json(
        { success: false, error: 'Only SVG and PNG files are allowed' },
        { status: 400 }
      );
    }
    
    // Create a unique filename
    const timestamp = new Date().getTime();
    const fileName = `${logoType}-logo-${timestamp}.${fileType}`;
    
    // Determine the directory and path
    const directory = logoType === 'header' ? 'header' : 'ai';
    const filePath = path.join(process.cwd(), 'public', 'logos', directory, fileName);
    
    // Create directory if it doesn't exist
    const dirPath = path.join(process.cwd(), 'public', 'logos', directory);
    try {
      await fs.access(dirPath);
    } catch (error) {
      // Directory doesn't exist, create it
      await fs.mkdir(dirPath, { recursive: true });
    }
    
    // Save the file
    const fileBuffer = Buffer.from(await logoFile.arrayBuffer());
    await writeFile(filePath, fileBuffer);
    
    // Create the public URL for the file
    const publicPath = `/logos/${directory}/${fileName}`;
    
    // Update the appropriate environment variable
    const envVar = logoType === 'header' 
      ? 'NEXT_PUBLIC_HEADER_LOGO_URL' 
      : 'NEXT_PUBLIC_AI_RESPONSE_LOGO_URL';
    
    try {
      await updateEnvFile(envVar, publicPath);
    } catch (error) {
      console.error('Error updating env file:', error);
      // Continue anyway, as the UI will still save the value through its normal mechanism
    }
    
    return NextResponse.json({
      success: true,
      filePath: publicPath,
      message: `${logoType === 'header' ? 'Header' : 'AI'} logo uploaded successfully`
    });
    
  } catch (error) {
    console.error('Error uploading logo file:', error);
    return NextResponse.json(
      { success: false, error: 'Error uploading logo file' },
      { status: 500 }
    );
  }
} 