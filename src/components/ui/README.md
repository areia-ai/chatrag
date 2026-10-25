# Component Customization

This folder contains UI components used throughout the application.

## Enhancing Components

Some components have enhanced versions available that add functionality without modifying the original components:

### Enhanced Markdown Component

To enable text streaming animations in AI responses, use the enhanced Markdown component:

1. Import from `patch-exports.ts` instead of directly from `markdown.tsx`:

```tsx
// Before
import { Markdown } from '@/components/ui/markdown';

// After 
import { Markdown } from '@/components/ui/patch-exports';
```

2. The enhanced version will automatically detect AI responses and apply streaming animations

### Using in chat-message.tsx

For the large chat-message.tsx file, you can override the Markdown component by changing the import at the top:

```diff
- import { Markdown } from '@/components/ui/markdown';
+ import { Markdown } from '@/components/ui/patch-exports';
```

This will enable streaming text for all AI responses without having to modify any of the component logic.