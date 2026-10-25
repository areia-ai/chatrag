/**
 * Apply Logo Size Helper
 * 
 * A minimal script to help the config UI apply logo size changes to the main window
 * by writing to localStorage and providing a convenient API.
 */
(function() {
  // Size mappings 
  const SIZE_MAP = {
    1: 24, // XS
    2: 32, // S
    3: 40, // M (default)
    4: 48, // L
    5: 56  // XL
  };
  
  // Function to apply logo size changes via localStorage
  window.applyLogoSizeChange = function(size) {
    try {
      // Validate size
      const numSize = parseInt(size);
      if (isNaN(numSize) || numSize < 1 || numSize > 5) {
        console.error('[applyLogoSizeChange] Invalid size:', size);
        return { success: false, error: 'Invalid size' };
      }
      
      // Store in localStorage (will be picked up by the main window)
      localStorage.setItem('AI_RESPONSE_LOGO_SIZE', numSize.toString());
      console.log(`[applyLogoSizeChange] Set AI_RESPONSE_LOGO_SIZE to ${numSize} (${SIZE_MAP[numSize]}px)`);
      
      // Attempt to trigger a storage event for other tabs/windows
      try {
        // This won't trigger in the same tab, but might help with other windows/tabs
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'AI_RESPONSE_LOGO_SIZE',
          newValue: numSize.toString(),
          oldValue: null,
          storageArea: localStorage
        }));
      } catch (eventError) {
        // Ignore event dispatch errors, not critical
        console.warn('[applyLogoSizeChange] Could not dispatch storage event:', eventError);
      }
      
      return { 
        success: true, 
        size: numSize,
        pixelSize: SIZE_MAP[numSize] || 40,
        message: `Set logo size to ${numSize} (${SIZE_MAP[numSize]}px)`
      };
    } catch (error) {
      console.error('[applyLogoSizeChange] Error:', error);
      return { success: false, error: error.message };
    }
  };
  
  console.log('[apply-logo-size] Helper script loaded');
})(); 