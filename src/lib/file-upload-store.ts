import { create } from 'zustand';
import { uploadFile } from './upload-utils';

interface FileUploadStore {
  file: File | null;
  fileUrl: string | null; // Now stores permanent downloadable URL
  fileType: 'image' | 'document' | null;
  isEnabled: boolean;
  isUploading: boolean;
  uploadError: string | null;
  downloadableUrl: string | null; // Permanent Supabase URL
  setFile: (file: File | null) => void;
  clearFile: () => void;
  toggleFileUpload: () => void;
}

export const useFileUploadStore = create<FileUploadStore>((set, get) => ({
  file: null,
  fileUrl: null,
  fileType: null,
  isEnabled: false,
  isUploading: false,
  uploadError: null,
  downloadableUrl: null,
  setFile: async (file) => {
    if (file) {
      const fileType = file.type.startsWith('image/') ? 'image' : 'document';
      
      // Set initial state with temporary URL
      const tempUrl = URL.createObjectURL(file);
      set({ 
        file, 
        fileUrl: tempUrl, 
        fileType, 
        isEnabled: true, 
        isUploading: true, 
        uploadError: null,
        downloadableUrl: null 
      });

      try {
        // Upload immediately to Supabase
        const result = await uploadFile(file, crypto.randomUUID());
        
        if (result.success && result.downloadUrl) {
          // Replace temporary URL with permanent downloadable URL
          URL.revokeObjectURL(tempUrl);
          set({ 
            fileUrl: result.downloadUrl,
            downloadableUrl: result.downloadUrl,
            isUploading: false,
            uploadError: null
          });
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } catch (error) {
        console.error('File upload failed:', error);
        set({ 
          isUploading: false, 
          uploadError: error instanceof Error ? error.message : 'Upload failed'
        });
      }
    } else {
      // Clear file
      const state = get();
      if (state.fileUrl && state.fileUrl.startsWith('blob:')) {
        URL.revokeObjectURL(state.fileUrl);
      }
      set({ 
        file: null, 
        fileUrl: null, 
        fileType: null, 
        isEnabled: false, 
        isUploading: false,
        uploadError: null,
        downloadableUrl: null
      });
    }
  },
  clearFile: () => {
    const state = get();
    if (state.fileUrl && state.fileUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.fileUrl);
    }
    set({ 
      file: null, 
      fileUrl: null, 
      fileType: null, 
      isEnabled: false, 
      isUploading: false,
      uploadError: null,
      downloadableUrl: null
    });
  },
  toggleFileUpload: () => {
    set((state) => ({ isEnabled: !state.isEnabled }));
  },
})); 