// Sidebar performance optimization: Extract all inline styles to prevent recreating objects on every render

// Dropdown styles - frozen to prevent mutations
export const DROPDOWN_STYLES = Object.freeze({
  dark: Object.freeze({
    backgroundColor: '#2F2F2F',
    color: '#E6E6E6',
    border: '1px solid #2F2F2F',
    hoverColor: '#424242'
  }),
  light: Object.freeze({
    backgroundColor: '#EFE1D5',
    color: '#444',
    border: '1px solid #EFE1D5',
    hoverColor: '#e5d6c9'
  })
});

// Dropdown item base styles
export const DROPDOWN_ITEM_BASE_STYLE = Object.freeze({
  border: 'none',
  padding: '12px 16px',
  margin: '2px 0',
  outline: 'none',
  borderRadius: '8px',
  transition: 'background-color 0.15s ease'
});

// Folder dropdown styles - matching chat dropdown for consistency
export const FOLDER_DROPDOWN_STYLES = Object.freeze({
  dark: Object.freeze({
    backgroundColor: '#2F2F2F',
    border: '1px solid #2F2F2F',
    hoverColor: '#424242'
  }),
  light: Object.freeze({
    backgroundColor: '#EFE1D5',
    border: '1px solid #EFE1D5',
    hoverColor: '#e5d6c9'
  })
});

// Folder item styles - deprecated, now using DROPDOWN_ITEM_BASE_STYLE
export const FOLDER_ITEM_STYLE = Object.freeze({
  backgroundColor: 'transparent',
  border: 'none',
  padding: '12px 16px',
  transition: 'background-color 0.15s ease',
  borderRadius: '8px',
  margin: '2px 0'
});

// Delete button styles
export const DELETE_BUTTON_STYLE = Object.freeze({
  color: '#EF4444'
});

// Delete item styles for folder
export const FOLDER_DELETE_ITEM_STYLE = Object.freeze({
  color: '#FF4A4A'
});

// Virtual list styles
export const VIRTUAL_LIST_CONTAINER_STYLE = Object.freeze({
  width: '100%',
  position: 'relative' as const
});

export const VIRTUAL_ITEM_STYLE = Object.freeze({
  position: 'absolute' as const,
  top: 0,
  left: 0,
  width: '100%'
});

// Scrolling title animation styles
export const SCROLLING_TITLE_STYLE = Object.freeze({
  opacity: 0,
  transform: 'translate3d(0, 0, 0)' // Force GPU acceleration
});

// Modal backdrop styles
export const MODAL_BACKDROP_STYLE = Object.freeze({
  backdropFilter: 'blur(1px)',
  WebkitBackdropFilter: 'blur(1px)'
});

// Helper functions for dynamic styles
export const getDropdownStyle = (theme: 'dark' | 'light') => {
  const styles = DROPDOWN_STYLES[theme];
  return {
    backgroundColor: styles.backgroundColor,
    color: styles.color,
    border: styles.border
  };
};

export const getDropdownItemStyle = (theme: 'dark' | 'light') => ({
  ...DROPDOWN_ITEM_BASE_STYLE,
  backgroundColor: DROPDOWN_STYLES[theme].backgroundColor,
  color: DROPDOWN_STYLES[theme].color
});

export const getFolderDropdownStyle = (theme: 'dark' | 'light') => {
  const styles = FOLDER_DROPDOWN_STYLES[theme];
  return {
    backgroundColor: styles.backgroundColor,
    border: styles.border
  };
};

export const getFolderItemStyle = (theme: 'dark' | 'light') => ({
  ...DROPDOWN_ITEM_BASE_STYLE,
  backgroundColor: DROPDOWN_STYLES[theme].backgroundColor,
  color: DROPDOWN_STYLES[theme].color
});

// Style for iOS specific adjustments
export const getIOSStyle = (isIOSSafari: boolean, isChromeIOS: boolean) => {
  if (isChromeIOS) {
    return { height: 'calc(100vh - 80px)' };
  }
  if (isIOSSafari) {
    return { paddingTop: '20px' };
  }
  return undefined;
};

// FAB button position style
export const getFABStyle = (isChromeIOS: boolean, isIOSSafari: boolean) => ({
  bottom: isChromeIOS ? '120px' : isIOSSafari ? '50px' : '100px'
});