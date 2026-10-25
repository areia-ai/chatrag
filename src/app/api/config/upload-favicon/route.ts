import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { writeFile } from 'fs/promises';
import { updateEnvFile } from '@/lib/env-utils';

// This route is used by the config UI to upload favicon files
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const faviconFile = formData.get('favicon') as File;
    
    if (!faviconFile) {
      return NextResponse.json(
        { success: false, error: 'Missing favicon file' },
        { status: 400 }
      );
    }
    
    // Validate file type
    const fileType = faviconFile.name.split('.').pop()?.toLowerCase();
    if (fileType !== 'ico' && fileType !== 'png' && fileType !== 'svg') {
      return NextResponse.json(
        { success: false, error: 'Only ICO, PNG, and SVG files are allowed' },
        { status: 400 }
      );
    }
    
    // Use the standard favicon filename based on file type
    const fileName = `favicon.${fileType}`;
    
    // Save to the public directory root
    const filePath = path.join(process.cwd(), 'public', fileName);
    
    // Save the file
    const fileBuffer = Buffer.from(await faviconFile.arrayBuffer());
    await writeFile(filePath, fileBuffer);
    
    // Create the public URL for the file
    const publicPath = `/${fileName}`;
    
    // Update the environment variable
    try {
      await updateEnvFile('NEXT_PUBLIC_FAVICON_URL', publicPath);
    } catch (error) {
      console.error('Error updating env file:', error);
      // Continue anyway, as the UI will still save the value through its normal mechanism
    }
    
    return NextResponse.json({
      success: true,
      url: publicPath,
      message: 'Favicon uploaded successfully'
    });
    
  } catch (error) {
    console.error('Error uploading favicon file:', error);
    return NextResponse.json(
      { success: false, error: 'Error uploading favicon file' },
      { status: 500 }
    );
  }
}