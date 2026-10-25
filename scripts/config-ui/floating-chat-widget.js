/**
 * Floating Chat Widget Component
 * 
 * A self-contained, embeddable chat widget that can be integrated into any website.
 * This component handles all aspects of the chat widget including:
 * - HTML structure generation
 * - Event handling
 * - Message management
 * - Real-time chat API integration
 * - Theme and styling customization
 * 
 * Usage:
 * const widget = new FloatingChatWidget(options);
 * widget.render(container);
 */

class FloatingChatWidget {
    constructor(options = {}) {
        // Default configuration
        this.config = {
            title: 'ChatRAG Assistant',
            primaryColor: '#FF6417',
            position: 'bottom-right',
            autoOpen: false,
            greeting: 'Hello! How can I help you today?',
            allowedDomains: [],
            requireAuth: false,
            apiEndpoint: '/api/embed/chat',
            containerId: null,  // If specified, widget will render inside this container
            isPreview: false,   // Special flag for preview mode
            ...options
        };
        
        // Internal state
        this.isOpen = false;
        this.messages = [];
        this.container = null;
        this.widgetElement = null;
        this.buttonElement = null;
        
        // Bind methods to maintain context
        this.toggle = this.toggle.bind(this);
        this.sendMessage = this.sendMessage.bind(this);
        this.handleKeyPress = this.handleKeyPress.bind(this);
    }
    
    /**
     * Generate the complete HTML structure for the widget
     */
    generateHTML() {
        return `
            <!-- Chat Preview Button -->
            <button 
                id="embedPreviewButton" 
                class="chat-preview-button"
                style="
                    position: absolute !important;
                    ${this.getPositionStyles()};
                    z-index: 100;
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    border: none;
                    background: ${this.config.primaryColor};
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    transition: all 0.3s ease;
                "
            >
                💬
            </button>

            <!-- Floating Chat Widget -->
            <div 
                id="inlineChatWidget" 
                class="inline-chat-widget" 
                style="
                    display: none !important;
                    position: absolute !important;
                    ${this.getWidgetPositionStyles()};
                    z-index: 200;
                    width: 350px;
                    height: 500px;
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                "
            >
                <!-- Chat Header -->
                <div 
                    id="chatHeader" 
                    class="chat-header"
                    style="
                        background: ${this.config.primaryColor};
                        color: white;
                        padding: 14px 20px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-weight: 600;
                        font-size: 16px;
                    "
                >
                    <span id="chatTitle">${this.config.title}</span>
                    <button 
                        class="chat-header-close"
                        style="
                            background: none;
                            border: none;
                            color: white;
                            font-size: 24px;
                            cursor: pointer;
                            padding: 0;
                            width: 30px;
                            height: 30px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 4px;
                            transition: background-color 0.2s;
                        "
                    >×</button>
                </div>

                <!-- Messages Container -->
                <div 
                    id="chatMessages" 
                    class="chat-messages"
                    style="
                        overflow-y: auto;
                        padding: 16px;
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                        background: #f8f9fa;
                        height: calc(500px - 120px);
                    "
                >
                    <div class="message assistant-message" style="
                        max-width: 85%;
                        align-self: flex-start;
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                        margin-bottom: 8px;
                        background: none !important;
                        padding: 0 !important;
                        border-radius: 0 !important;
                        box-shadow: none !important;
                    ">
                                                <div class="message-meta" style="
                             font-size: 11px;
                             color: #8b9299;
                             margin-bottom: 4px;
                             font-weight: 500;
                             letter-spacing: 0.2px;
                         ">Assistant</div>
                        <div class="message-content" style="
                            background: #ffffff;
                            color: #2d3748;
                            padding: 12px 16px;
                            border-radius: 18px 18px 18px 5px;
                            line-height: 1.45;
                            word-wrap: break-word;
                            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1);
                            border: 1px solid #f1f3f4;
                            font-size: 14px;
                            font-weight: 400;
                            max-width: 100%;
                        ">${this.config.greeting}</div>
                    </div>
                </div>

                <!-- Chat Input Area -->
                <div 
                    class="chat-input-area"
                    style="
                        padding: 12px 16px 16px 16px;
                        background: white;
                        border-top: 1px solid #e9ecef;
                    "
                >
                    <div 
                        class="chat-input-form"
                        style="
                            display: flex;
                            gap: 8px;
                            align-items: end;
                        "
                    >
                        <textarea 
                            id="chatInput" 
                            placeholder="Type a message..."
                            class="chat-input-field"
                            rows="1"
                            style="
                                flex: 1;
                                border: 1px solid #e9ecef;
                                border-radius: 20px;
                                padding: 10px 16px;
                                resize: none;
                                outline: none;
                                font-family: inherit;
                                font-size: 14px;
                                line-height: 1.4;
                                max-height: 80px;
                                min-height: 40px;
                                overflow: hidden;
                                overflow-y: auto;
                                scrollbar-width: none;
                                -ms-overflow-style: none;
                            "
                        ></textarea>
                        <button 
                            class="chat-send-button"
                            style="
                                background: ${this.config.primaryColor};
                                border: none;
                                color: white;
                                width: 40px;
                                height: 40px;
                                border-radius: 50%;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 16px;
                                transition: background-color 0.2s;
                            "
                        >
                            ↗
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Get position styles for the chat button based on config
     */
    getPositionStyles() {
        const positions = {
            'bottom-right': 'bottom: 20px; right: 20px;',
            'bottom-left': 'bottom: 20px; left: 20px;',
            'top-right': 'top: 20px; right: 20px;',
            'top-left': 'top: 20px; left: 20px;'
        };
        return positions[this.config.position] || positions['bottom-right'];
    }
    
    /**
     * Get position styles for the chat widget based on button position
     * Widget appears at exactly the same position as button (overlapping)
     */
    getWidgetPositionStyles() {
        const positions = {
            'bottom-right': 'bottom: 20px; right: 20px;',
            'bottom-left': 'bottom: 20px; left: 20px;',
            'top-right': 'top: 20px; right: 20px;',
            'top-left': 'top: 20px; left: 20px;'
        };
        return positions[this.config.position] || positions['bottom-right'];
    }
    
    /**
     * Ensure widget stays within container bounds
     */
    adjustWidgetPositioning() {
        if (!this.container || !this.widgetElement) return;
        
        const containerRect = this.container.getBoundingClientRect();
        
        // Widget dimensions
        const widgetWidth = 350;
        const widgetHeight = 500;
        
        // Calculate max positions to stay in bounds
        const maxRight = containerRect.width - widgetWidth;
        const maxBottom = containerRect.height - widgetHeight;
        const maxLeft = widgetWidth + 20;
        const maxTop = widgetHeight + 20;
        
        // Adjust if widget would overflow
        let position = this.config.position;
        
        if (position.includes('right') && maxRight < 20) {
            position = position.replace('right', 'left');
        }
        if (position.includes('bottom') && maxBottom < 20) {
            position = position.replace('bottom', 'top');
        }
        if (position.includes('left') && containerRect.width < maxLeft) {
            position = position.replace('left', 'right');
        }
        if (position.includes('top') && containerRect.height < maxTop) {
            position = position.replace('top', 'bottom');
        }
        
        // Apply adjusted positioning
        this.config.position = position;
        
        // Update both button and widget positions
        if (this.buttonElement) {
            const buttonStyles = this.getPositionStyles();
            this.buttonElement.style.cssText += buttonStyles;
        }
        
        if (this.widgetElement) {
            const widgetStyles = this.getWidgetPositionStyles();
            this.widgetElement.style.cssText += widgetStyles;
        }
        
        console.log(`FloatingChatWidget: Adjusted positioning to ${position}`);
    }
    
    /**
     * Render the widget into the specified container
     */
    render(container) {
        // If containerId is specified, use that instead
        if (this.config.containerId) {
            const targetContainer = document.getElementById(this.config.containerId);
            if (targetContainer) {
                container = targetContainer;
            } else {
                console.error('FloatingChatWidget: Container with ID ' + this.config.containerId + ' not found');
                return;
            }
        }
        
        if (!container) {
            console.error('FloatingChatWidget: Container element is required');
            return;
        }
        
        this.container = container;
        
        // Create a wrapper div to hold our widget
        const wrapper = document.createElement('div');
        wrapper.className = 'chatrag-widget-container';
        wrapper.style.position = 'relative';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.innerHTML = this.generateHTML();
        
        // Clear container and add wrapper
        if (this.config.isPreview) {
            // For preview mode, append to container without clearing
            container.appendChild(wrapper);
        } else {
            container.innerHTML = '';
            container.appendChild(wrapper);
        }
        
        // Store references to key elements
        this.buttonElement = wrapper.querySelector('#embedPreviewButton');
        this.widgetElement = wrapper.querySelector('#inlineChatWidget');
        this.messagesContainer = wrapper.querySelector('#chatMessages');
        this.inputElement = wrapper.querySelector('#chatInput');
        this.sendButton = wrapper.querySelector('.chat-send-button');
        this.closeButton = wrapper.querySelector('.chat-header-close');
        
        // Attach event listeners
        this.attachEventListeners();
        
        // Ensure proper positioning within container
        this.adjustWidgetPositioning();
        
        // Auto-open if configured
        if (this.config.autoOpen) {
            setTimeout(() => this.open(), 3000);
        }
        
        console.log('FloatingChatWidget: Rendered successfully');
    }
    
    /**
     * Attach all event listeners
     */
    attachEventListeners() {
        if (!this.buttonElement || !this.widgetElement) return;
        
        // Button click to toggle widget
        this.buttonElement.addEventListener('click', this.toggle);
        
        // Close button click
        if (this.closeButton) {
            this.closeButton.addEventListener('click', this.close.bind(this));
        }
        
        // Send button click
        if (this.sendButton) {
            this.sendButton.addEventListener('click', this.sendMessage);
        }
        
        // Enter key to send message
        if (this.inputElement) {
            this.inputElement.addEventListener('keydown', this.handleKeyPress);
            
            // Auto-resize textarea
            this.inputElement.addEventListener('input', this.autoResizeTextarea.bind(this));
        }
        
        // Add hover effects for buttons
        this.addHoverEffects();
    }
    
    /**
     * Handle key press events in the input field
     */
    handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    }
    
    /**
     * Auto-resize textarea based on content
     */
    autoResizeTextarea() {
        if (!this.inputElement) return;
        
        // Reset height to calculate new scroll height
        this.inputElement.style.height = 'auto';
        
        // Calculate new height
        const newHeight = Math.min(this.inputElement.scrollHeight, 80);
        this.inputElement.style.height = newHeight + 'px';
        
        // Only show scrollbar if content exceeds max height
        if (this.inputElement.scrollHeight > 80) {
            this.inputElement.classList.add('show-scrollbar');
            this.inputElement.style.overflowY = 'auto';
        } else {
            this.inputElement.classList.remove('show-scrollbar');
            this.inputElement.style.overflowY = 'hidden';
        }
    }
    
    /**
     * Add hover effects to interactive elements
     */
    addHoverEffects() {
        // Chat button hover
        if (this.buttonElement) {
            this.buttonElement.addEventListener('mouseenter', () => {
                this.buttonElement.style.transform = 'scale(1.1)';
            });
            this.buttonElement.addEventListener('mouseleave', () => {
                this.buttonElement.style.transform = 'scale(1)';
            });
        }
        
        // Send button hover
        if (this.sendButton) {
            this.sendButton.addEventListener('mouseenter', () => {
                this.sendButton.style.opacity = '0.8';
            });
            this.sendButton.addEventListener('mouseleave', () => {
                this.sendButton.style.opacity = '1';
            });
        }
        
        // Close button hover
        if (this.closeButton) {
            this.closeButton.addEventListener('mouseenter', () => {
                this.closeButton.style.backgroundColor = 'rgba(255,255,255,0.2)';
            });
            this.closeButton.addEventListener('mouseleave', () => {
                this.closeButton.style.backgroundColor = 'transparent';
            });
        }
    }
    
    /**
     * Toggle the widget open/closed state
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
    
    /**
     * Open the chat widget
     */
    open() {
        if (!this.widgetElement || !this.buttonElement) return;
        
        // Keep button visible, show widget on top of it
        // Button stays visible underneath widget
        this.widgetElement.style.setProperty('display', 'block', 'important');
        this.isOpen = true;
        
        // Auto-focus the input after a short delay
        setTimeout(() => {
            if (this.inputElement) {
                this.inputElement.focus();
            }
        }, 100);
        
        console.log('FloatingChatWidget: Opened - widget on top of button');
    }
    
    /**
     * Close the chat widget
     */
    close() {
        if (!this.widgetElement || !this.buttonElement) return;
        
        // Hide widget, button remains visible
        this.widgetElement.style.setProperty('display', 'none', 'important');
        this.isOpen = false;
        
        console.log('FloatingChatWidget: Closed - button visible again');
    }
    
    /**
     * Send a message
     */
    async sendMessage() {
        if (!this.inputElement || !this.inputElement.value.trim()) return;
        
        const userMessage = this.inputElement.value.trim();
        this.inputElement.value = '';
        this.inputElement.style.height = 'auto'; // Reset textarea height
        
        // Add user message to display
        this.addUserMessage(userMessage);
        
        // Add to conversation history
        this.messages.push({
            role: 'user',
            content: userMessage
        });
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            // Send to API
            await this.sendToAPI();
        } catch (error) {
            console.error('FloatingChatWidget: Error sending message:', error);
            this.hideTypingIndicator();
            this.addErrorMessage('Sorry, I encountered an error. Please try again.');
        }
    }
    
    /**
     * Add a user message to the display
     */
    addUserMessage(content) {
        if (!this.messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        messageDiv.style.cssText = `
            max-width: 85%;
            align-self: flex-end;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            margin-bottom: 8px;
            background: none !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
        `;
        
        messageDiv.innerHTML = `
            <div class="message-meta" style="
                font-size: 11px;
                color: rgba(255,255,255,0.8);
                margin-bottom: 4px;
                font-weight: 500;
                letter-spacing: 0.2px;
                text-align: right;
            ">You</div>
            <div class="message-content" style="
                background: ${this.config.primaryColor};
                color: white;
                padding: 12px 16px;
                border-radius: 18px 18px 4px 18px;
                line-height: 1.45;
                word-wrap: break-word;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                font-size: 14px;
                font-weight: 400;
                max-width: 100%;
            ">${this.escapeHtml(content)}</div>
        `;
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    /**
     * Add an assistant message to the display
     */
    addAssistantMessage(content) {
        if (!this.messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant-message';
        messageDiv.style.cssText = `
            max-width: 85%;
            align-self: flex-start;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-bottom: 8px;
            background: none !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
        `;
        
        messageDiv.innerHTML = `
            <div class="message-meta" style="
                font-size: 11px;
                color: #8b9299;
                margin-bottom: 4px;
                font-weight: 500;
                letter-spacing: 0.2px;
            ">Assistant</div>
            <div class="message-content" style="
                background: #ffffff;
                color: #2d3748;
                padding: 12px 16px;
                border-radius: 18px 18px 18px 4px;
                line-height: 1.45;
                word-wrap: break-word;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                font-size: 14px;
                font-weight: 400;
                max-width: 100%;
            ">${this.formatMarkdown(content)}</div>
        `;
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }
    
    /**
     * Add an error message to the display
     */
    addErrorMessage(content) {
        if (!this.messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant-message error';
        messageDiv.style.cssText = `
            max-width: 85%;
            align-self: flex-start;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-bottom: 8px;
            background: none !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
        `;
        
        messageDiv.innerHTML = `
            <div class="message-meta" style="
                font-size: 11px;
                color: #ef4444;
                margin-bottom: 4px;
                font-weight: 500;
                letter-spacing: 0.2px;
            ">System</div>
            <div class="message-content" style="
                background: #fef2f2;
                color: #b91c1c;
                padding: 12px 16px;
                border-radius: 18px 18px 18px 5px;
                line-height: 1.45;
                word-wrap: break-word;
                border: 1px solid #fecaca;
                box-shadow: 0 1px 3px rgba(239, 68, 68, 0.1);
                font-size: 14px;
                font-weight: 400;
                max-width: 100%;
            ">${this.escapeHtml(content)}</div>
        `;
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        this.hideTypingIndicator(); // Remove any existing indicator
        
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typingIndicator';
        typingDiv.className = 'message assistant-message';
        typingDiv.style.cssText = `
            max-width: 85%;
            align-self: flex-start;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-bottom: 8px;
            background: none !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
        `;
        
        typingDiv.innerHTML = `
            <div class="message-meta" style="
                font-size: 11px;
                color: #8b9299;
                margin-bottom: 4px;
                font-weight: 500;
                letter-spacing: 0.2px;
            ">Assistant</div>
            <div class="message-content" style="
                background: #ffffff;
                color: #2d3748;
                padding: 12px 16px;
                border-radius: 18px 18px 18px 4px;
                line-height: 1.45;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                font-weight: 400;
                max-width: 100%;
            ">
                <div style="display: flex; gap: 2px;">
                    <div class="typing-dot" style="
                        width: 6px;
                        height: 6px;
                        background: #ccc;
                        border-radius: 50%;
                        animation: typing 1.4s infinite ease-in-out;
                    "></div>
                    <div class="typing-dot" style="
                        width: 6px;
                        height: 6px;
                        background: #ccc;
                        border-radius: 50%;
                        animation: typing 1.4s infinite ease-in-out;
                        animation-delay: 0.2s;
                    "></div>
                    <div class="typing-dot" style="
                        width: 6px;
                        height: 6px;
                        background: #ccc;
                        border-radius: 50%;
                        animation: typing 1.4s infinite ease-in-out;
                        animation-delay: 0.4s;
                    "></div>
                </div>
                <span style="margin-left: 8px; font-size: 12px; color: #999;">Thinking...</span>
            </div>
        `;
        
        // Add typing animation and scrollbar styles if not already present
        if (!document.getElementById('floatingWidgetTypingCSS')) {
            const style = document.createElement('style');
            style.id = 'floatingWidgetTypingCSS';
            style.textContent = `
                @keyframes typing {
                    0%, 60%, 100% { 
                        transform: translateY(0); 
                        opacity: 0.4; 
                    }
                    30% { 
                        transform: translateY(-8px); 
                        opacity: 1; 
                    }
                }
                
                /* Hide scrollbar for chat input until needed */
                .chat-input-field::-webkit-scrollbar {
                    width: 0px;
                    background: transparent;
                }
                
                .chat-input-field.show-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                
                .chat-input-field.show-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                
                .chat-input-field.show-scrollbar::-webkit-scrollbar-thumb {
                    background: #cbd5e0;
                    border-radius: 2px;
                }
                
                .chat-input-field.show-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #a0aec0;
                }
            `;
            document.head.appendChild(style);
        }
        
        this.messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }
    
    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    /**
     * Send message to the chat API
     */
    async sendToAPI() {
        const response = await fetch(this.config.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: this.messages,
                model: this.config.model || 'openai/gpt-5'
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        this.hideTypingIndicator();
        
        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        
        // Create assistant message container for streaming
        const messageDiv = this.addAssistantMessage('');
        const contentDiv = messageDiv.querySelector('.message-content');
        
        // Read the streaming response
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.trim() === '') continue;
                
                try {
                    // Handle AI SDK streaming format
                    if (line.startsWith('0:')) {
                        // Text content: 0:"content"
                        const jsonPart = line.slice(2);
                        const textDelta = JSON.parse(jsonPart);
                        assistantMessage += textDelta;
                        if (contentDiv) {
                            contentDiv.innerHTML = this.formatMarkdown(assistantMessage);
                        }
                        this.scrollToBottom();
                    } else if (line.startsWith('3:')) {
                        // Error message: 3:"error"
                        const jsonPart = line.slice(2);
                        const errorMessage = JSON.parse(jsonPart);
                        throw new Error(errorMessage);
                    }
                } catch (e) {
                    console.debug('FloatingChatWidget: Could not parse line:', line, e);
                }
            }
        }
        
        // Ensure we have content
        if (!assistantMessage.trim()) {
            assistantMessage = 'I received your message but encountered an issue. Please try again.';
            if (contentDiv) {
                contentDiv.innerHTML = assistantMessage;
            }
        }
        
        // Add assistant message to conversation history
        this.messages.push({
            role: 'assistant',
            content: assistantMessage
        });
    }
    
    /**
     * Scroll messages container to bottom
     */
    scrollToBottom() {
        if (this.messagesContainer) {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }
    }
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Format markdown text for display with clickable links and emails
     */
    formatMarkdown(text) {
        // First escape HTML to prevent XSS, but preserve the text for link processing
        let formattedText = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        // URL regex pattern - matches http/https URLs
        const urlRegex = /(https?:\/\/[^\s<>"']+[^\s<>"'.,!?;:()])/gi;
        
        // Email regex pattern
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
        
        // Replace URLs with clickable links
        formattedText = formattedText.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #1e40af; text-decoration: underline; cursor: pointer; word-break: break-all; overflow-wrap: break-word;" onmouseover="this.style.color='#1d4ed8'" onmouseout="this.style.color='#1e40af'">${url}</a>`;
        });
        
        // Replace emails with clickable mailto links
        formattedText = formattedText.replace(emailRegex, (email) => {
            return `<a href="mailto:${email}" style="color: #1e40af; text-decoration: underline; cursor: pointer;" onmouseover="this.style.color='#1d4ed8'" onmouseout="this.style.color='#1e40af'">${email}</a>`;
        });
        
        // Apply markdown formatting
        return formattedText
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code style="background: #f1f3f4; padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>')
            .replace(/\n/g, '<br>');
    }
    
    /**
     * Update widget configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Update UI elements if they exist
        if (this.container) {
            // Re-render with new configuration
            this.render(this.container);
        }
    }
    
    /**
     * Get current widget state
     */
    getState() {
        return {
            isOpen: this.isOpen,
            messages: this.messages,
            config: this.config
        };
    }
    
    /**
     * Clear all messages
     */
    clearMessages() {
        this.messages = [];
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = `
                <div class="message assistant-message" style="
                    max-width: 85%; 
                    align-self: flex-start;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    margin-bottom: 8px;
                    background: none !important;
                    padding: 0 !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                ">
                                         <div class="message-meta" style="
                         font-size: 11px;
                         color: #8b9299;
                         margin-bottom: 4px;
                         font-weight: 500;
                         letter-spacing: 0.2px;
                     ">Assistant</div>
                     <div class="message-content" style="
                         background: #ffffff;
                         color: #2d3748;
                         padding: 12px 16px;
                         border-radius: 18px 18px 18px 5px;
                         line-height: 1.45;
                         word-wrap: break-word;
                         box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1);
                         border: 1px solid #f1f3f4;
                         font-size: 14px;
                         font-weight: 400;
                         max-width: 100%;
                     ">${this.config.greeting}</div>
                </div>
            `;
        }
    }
    
    /**
     * Initialize the widget - convenience method that auto-renders
     */
    init() {
        // If containerId is specified, use that
        if (this.config.containerId) {
            const container = document.getElementById(this.config.containerId);
            if (container) {
                this.render(container);
            } else {
                console.error('FloatingChatWidget: Container with ID ' + this.config.containerId + ' not found');
            }
        } else {
            // Default to body
            this.render(document.body);
        }
    }
    
    /**
     * Destroy the widget and clean up event listeners
     */
    destroy() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        
        // Remove any CSS we added
        const typingCSS = document.getElementById('floatingWidgetTypingCSS');
        if (typingCSS) {
            typingCSS.remove();
        }
        
        // Reset internal state
        this.isOpen = false;
        this.messages = [];
        this.container = null;
        this.widgetElement = null;
        this.buttonElement = null;
        
        console.log('FloatingChatWidget: Destroyed');
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FloatingChatWidget;
} else if (typeof window !== 'undefined') {
    window.FloatingChatWidget = FloatingChatWidget;
} 