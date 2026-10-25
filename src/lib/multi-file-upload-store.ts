import { create } from 'zustand';
import { uploadFile } from './upload-utils';

interface UploadedFile {
  file: File;
  tempUrl: string;
  uploadedUrl?: string;
  isUploading: boolean;
  error?: string;
}

interface MultiFileUploadStore {
  files: UploadedFile[];
  maxFiles: number;

  // Actions
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  clearAllFiles: () => void;
  getFilesArray: () => File[];
  hasFiles: () => boolean;
}

export const useMultiFileUploadStore = create<MultiFileUploadStore>((set, get) => ({
  files: [],
  maxFiles: 10, // Seedream v4 supports up to 10 images

  addFiles: async (newFiles: File[]) => {
    const state = get();
    const currentCount = state.files.length;
    const remainingSlots = state.maxFiles - currentCount;

    if (remainingSlots <= 0) {
      console.warn(`Maximum of ${state.maxFiles} files already reached`);
      return;
    }

    // Limit to available slots
    const filesToAdd = newFiles.slice(0, remainingSlots);

    // Create upload entries for new files
    const uploadEntries: UploadedFile[] = filesToAdd.map(file => ({
      file,
      tempUrl: URL.createObjectURL(file),
      isUploading: true
    }));

    // Add to store immediately with temp URLs
    set(state => ({
      files: [...state.files, ...uploadEntries]
    }));

    // Upload files asynchronously
    uploadEntries.forEach(async (entry, index) => {
      try {
        const result = await uploadFile(entry.file, crypto.randomUUID());

        if (result.success && result.downloadUrl) {
          // Clean up temp URL
          URL.revokeObjectURL(entry.tempUrl);

          // Update with uploaded URL
          set(state => ({
            files: state.files.map((f, i) =>
              f === entry ? {
                ...f,
                uploadedUrl: result.downloadUrl,
                isUploading: false
              } : f
            )
          }));
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } catch (error) {
        console.error('File upload failed:', error);
        set(state => ({
          files: state.files.map((f, i) =>
            f === entry ? {
              ...f,
              isUploading: false,
              error: error instanceof Error ? error.message : 'Upload failed'
            } : f
          )
        }));
      }
    });
  },

  removeFile: (index: number) => {
    const state = get();
    const fileToRemove = state.files[index];

    if (fileToRemove) {
      // Clean up URLs
      if (fileToRemove.tempUrl && fileToRemove.tempUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fileToRemove.tempUrl);
      }

      // Remove from array
      set(state => ({
        files: state.files.filter((_, i) => i !== index)
      }));
    }
  },

  clearAllFiles: () => {
    const state = get();

    // Clean up all URLs
    state.files.forEach(file => {
      if (file.tempUrl && file.tempUrl.startsWith('blob:')) {
        URL.revokeObjectURL(file.tempUrl);
      }
    });

    set({ files: [] });
  },

  getFilesArray: () => {
    return get().files.map(f => f.file);
  },

  hasFiles: () => {
    return get().files.length > 0;
  }
}));