// RAG Configuration Manager
// Handles RAG settings display and editing within document processing

class RagConfigManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentConfig = null;
    this.originalConfig = null;
    this.isEditing = false;
    this.callbacks = [];
    this.settingsRequiringRestart = ['embeddingModel', 'chunkStrategy', 'chunkSize', 'chunkOverlap'];
  }

  // Initialize the RAG config manager
  async init() {
    try {
      await this.loadConfig();
      this.setupConfigDisplay();
      this.bindEvents();
      console.log('RAG config manager initialized');
    } catch (error) {
      console.error('Failed to initialize RAG config manager:', error);
    }
  }

  // Load current RAG configuration
  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      
      this.currentConfig = {
        chunkStrategy: data.config.LLAMACLOUD_CHUNK_STRATEGY || 'sentence',
        chunkSize: parseInt(data.config.LLAMACLOUD_CHUNK_SIZE) || 1500,
        chunkOverlap: parseInt(data.config.LLAMACLOUD_CHUNK_OVERLAP) || 100,
        multimodal: data.config.LLAMACLOUD_MULTIMODAL_PARSING === 'true',
        embeddingModel: data.config.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
        // Advanced parsing options
        parseMode: data.config.LLAMACLOUD_PARSE_MODE || 'parse_page_with_agent',
        parseModel: data.config.LLAMACLOUD_PARSE_MODEL || 'gemini-2.5-pro',
        highResOcr: data.config.LLAMACLOUD_HIGH_RES_OCR === 'true',
        adaptiveLongTable: data.config.LLAMACLOUD_ADAPTIVE_LONG_TABLE === 'true',
        outlinedTableExtraction: data.config.LLAMACLOUD_OUTLINED_TABLE_EXTRACTION === 'true',
        outputTablesAsHtml: data.config.LLAMACLOUD_OUTPUT_TABLES_AS_HTML === 'true'
      };
      
      // Store original config for comparison
      this.originalConfig = {...this.currentConfig};

      this.notifyConfigChange();
    } catch (error) {
      console.error('Failed to load RAG config:', error);
      // Use defaults
      this.currentConfig = {
        chunkStrategy: 'sentence',
        chunkSize: 1500,
        chunkOverlap: 100,
        multimodal: true,
        embeddingModel: 'text-embedding-3-small',
        // Advanced parsing options
        parseMode: 'parse_page_with_agent',
        parseModel: 'gemini-2.5-pro',
        highResOcr: true,
        adaptiveLongTable: true,
        outlinedTableExtraction: true,
        outputTablesAsHtml: true
      };
    }
  }

  // Set up the configuration display
  setupConfigDisplay() {
    if (!this.container) {
      console.error('RAG config container not found');
      return;
    }

    this.container.innerHTML = `
      <div class="rag-config-manager">
        <div class="config-header">
          <h3>⚙️ RAG Configuration</h3>
          <div class="config-actions">
            <button id="editRagConfig" class="btn btn-primary btn-sm">
              ✏️ Edit Configuration
            </button>
            <button id="testRagConfig" class="btn btn-info btn-sm">
              🧪 Test Configuration
            </button>
            <button id="resetRagConfig" class="btn btn-secondary btn-sm" style="display: none;">
              🔄 Reset to Defaults
            </button>
          </div>
        </div>

        <div class="config-display" id="configDisplay">
          ${this.renderConfigDisplay()}
        </div>

        <div class="config-editor" id="configEditor" style="display: none;">
          ${this.renderConfigEditor()}
        </div>

        <div class="config-info">
          <div class="info-section">
            <h4>📖 Configuration Guide</h4>
            <div class="config-descriptions">
              <div class="description-item">
                <strong>Chunk Strategy:</strong> How text is split into chunks
                <ul>
                  <li><code>sentence</code> - Split by sentences (recommended)</li>
                  <li><code>paragraph</code> - Split by paragraphs</li>
                  <li><code>character</code> - Split by character count</li>
                </ul>
              </div>
              <div class="description-item">
                <strong>Chunk Size:</strong> Maximum size of each text chunk (100-3500 characters)
              </div>
              <div class="description-item">
                <strong>Chunk Overlap:</strong> Characters to overlap between chunks (0-chunk size)
              </div>
              <div class="description-item">
                <strong>Multimodal:</strong> Extract and process images from documents
              </div>
              <div class="description-item">
                <strong>Embedding Model:</strong> OpenAI model used for text embeddings
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Render the configuration display (read-only)
  renderConfigDisplay() {
    if (!this.currentConfig) return '<div>Loading configuration...</div>';

    return `
      <div class="config-section">
        <h4>📄 Chunking Configuration</h4>
        <div class="config-grid">
          <div class="config-item">
            <span class="config-label">Chunk Strategy:</span>
            <span class="config-value">${this.currentConfig.chunkStrategy}</span>
          </div>
          <div class="config-item">
            <span class="config-label">Chunk Size:</span>
            <span class="config-value">${this.currentConfig.chunkSize} characters</span>
          </div>
          <div class="config-item">
            <span class="config-label">Chunk Overlap:</span>
            <span class="config-value">${this.currentConfig.chunkOverlap} characters</span>
          </div>
          <div class="config-item">
            <span class="config-label">Embedding Model:</span>
            <span class="config-value">${this.currentConfig.embeddingModel}</span>
          </div>
        </div>
      </div>

      <div class="config-section">
        <h4>🧠 Advanced Parsing Features</h4>
        <div class="config-grid">
          <div class="config-item">
            <span class="config-label">Parse Mode:</span>
            <span class="config-value">${this.currentConfig.parseMode}</span>
          </div>
          <div class="config-item">
            <span class="config-label">Parse Model:</span>
            <span class="config-value">${this.getModelDisplayName(this.currentConfig.parseModel)}</span>
          </div>
          <div class="config-item">
            <span class="config-label">High-Res OCR:</span>
            <span class="config-value ${this.currentConfig.highResOcr ? 'enabled' : 'disabled'}">
              ${this.currentConfig.highResOcr ? '✅ Enabled' : '❌ Disabled'}
            </span>
          </div>
          <div class="config-item">
            <span class="config-label">Adaptive Long Tables:</span>
            <span class="config-value ${this.currentConfig.adaptiveLongTable ? 'enabled' : 'disabled'}">
              ${this.currentConfig.adaptiveLongTable ? '✅ Enabled' : '❌ Disabled'}
            </span>
          </div>
          <div class="config-item">
            <span class="config-label">Outlined Table Extraction:</span>
            <span class="config-value ${this.currentConfig.outlinedTableExtraction ? 'enabled' : 'disabled'}">
              ${this.currentConfig.outlinedTableExtraction ? '✅ Enabled' : '❌ Disabled'}
            </span>
          </div>
          <div class="config-item">
            <span class="config-label">HTML Table Output:</span>
            <span class="config-value ${this.currentConfig.outputTablesAsHtml ? 'enabled' : 'disabled'}">
              ${this.currentConfig.outputTablesAsHtml ? '✅ Enabled' : '❌ Disabled'}
            </span>
          </div>
          <div class="config-item">
            <span class="config-label">Multimodal Processing:</span>
            <span class="config-value ${this.currentConfig.multimodal ? 'enabled' : 'disabled'}">
              ${this.currentConfig.multimodal ? '✅ Enabled' : '❌ Disabled'}
            </span>
          </div>
        </div>
      </div>
      
      <div class="config-summary">
        <h4>📊 Processing Impact</h4>
        <div class="impact-grid">
          <div class="impact-item">
            <span class="impact-label">Estimated chunks per page:</span>
            <span class="impact-value">${this.estimateChunksPerPage()}</span>
          </div>
          <div class="impact-item">
            <span class="impact-label">Processing complexity:</span>
            <span class="impact-value">${this.getProcessingComplexity()}</span>
          </div>
          <div class="impact-item">
            <span class="impact-label">Credit cost (10 pages):</span>
            <span class="impact-value">${this.estimateCreditCost(10)} credits</span>
          </div>
          <div class="impact-item">
            <span class="impact-label">Model quality:</span>
            <span class="impact-value">${this.getModelInfo().quality}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Render the configuration editor
  renderConfigEditor() {
    if (!this.currentConfig) return '<div>Loading...</div>';

    return `
      <div class="config-form">
        <div class="form-group requires-restart" data-setting="chunkStrategy">
          <label for="chunkStrategy">Chunk Strategy:</label>
          <select id="chunkStrategy" value="${this.currentConfig.chunkStrategy}">
            <option value="sentence" ${this.currentConfig.chunkStrategy === 'sentence' ? 'selected' : ''}>
              Sentence (Recommended)
            </option>
            <option value="paragraph" ${this.currentConfig.chunkStrategy === 'paragraph' ? 'selected' : ''}>
              Paragraph
            </option>
            <option value="character" ${this.currentConfig.chunkStrategy === 'character' ? 'selected' : ''}>
              Character
            </option>
          </select>
        </div>

        <div class="form-group requires-restart" data-setting="chunkSize">
          <label for="chunkSize">Chunk Size (characters):</label>
          <input type="range" id="chunkSize" min="100" max="3500" step="100" 
                 value="${this.currentConfig.chunkSize}" 
                 oninput="document.getElementById('chunkSizeValue').textContent = this.value">
          <div class="slider-value">
            <span id="chunkSizeValue">${this.currentConfig.chunkSize}</span> characters
          </div>
        </div>

        <div class="form-group requires-restart" data-setting="chunkOverlap">
          <label for="chunkOverlap">Chunk Overlap (characters):</label>
          <input type="range" id="chunkOverlap" min="0" max="500" step="10" 
                 value="${this.currentConfig.chunkOverlap}"
                 oninput="document.getElementById('chunkOverlapValue').textContent = this.value">
          <div class="slider-value">
            <span id="chunkOverlapValue">${this.currentConfig.chunkOverlap}</span> characters
          </div>
        </div>

        <div class="form-group requires-restart" data-setting="embeddingModel">
          <label for="embeddingModel">Embedding Model:</label>
          <select id="embeddingModel" value="${this.currentConfig.embeddingModel}">
            <option value="text-embedding-3-small" ${this.currentConfig.embeddingModel === 'text-embedding-3-small' ? 'selected' : ''}>
              text-embedding-3-small (Recommended)
            </option>
            <option value="text-embedding-3-large" ${this.currentConfig.embeddingModel === 'text-embedding-3-large' ? 'selected' : ''}>
              text-embedding-3-large (Higher accuracy, uses adaptive retrieval for full 3072 dims)
            </option>
            <option value="text-embedding-ada-002" ${this.currentConfig.embeddingModel === 'text-embedding-ada-002' ? 'selected' : ''}>
              text-embedding-ada-002 (Legacy)
            </option>
          </select>
          <div id="embeddingModelWarning" class="mt-2 p-3 bg-info/10 border border-info rounded-lg text-sm hidden">
            <strong>ℹ️ Note:</strong> text-embedding-3-large uses adaptive retrieval to leverage full 3072 dimensions while working within pgvector's index limits. 
            This provides ~99% accuracy compared to full 3072-dim search but uses ~2.5x more storage per document.
          </div>
        </div>

        <hr class="my-4">
        <h4 class="mb-3">🧠 Advanced Parsing Features</h4>

        <div class="form-group">
          <label for="parseMode">Parse Mode:</label>
          <select id="parseMode" value="${this.currentConfig.parseMode}">
            <option value="parse_page_with_agent" ${this.currentConfig.parseMode === 'parse_page_with_agent' ? 'selected' : ''}>
              AI Agent Parsing (Best Quality)
            </option>
            <option value="fast" ${this.currentConfig.parseMode === 'fast' ? 'selected' : ''}>
              Fast Mode
            </option>
            <option value="balanced" ${this.currentConfig.parseMode === 'balanced' ? 'selected' : ''}>
              Balanced Mode
            </option>
          </select>
          <small class="form-text text-muted">AI Agent mode uses advanced models for intelligent document understanding</small>
        </div>

        <div class="form-group">
          <label for="parseModel">Parse Model:</label>
          <select id="parseModel" value="${this.currentConfig.parseModel}">
            <option value="openai-gpt-4-1-mini" ${this.currentConfig.parseModel === 'openai-gpt-4-1-mini' ? 'selected' : ''}>
              GPT-4.1 Mini (10 credits/page) 💰 Most Economical
            </option>
            <option value="gemini-2.0-flash" ${this.currentConfig.parseModel === 'gemini-2.0-flash' ? 'selected' : ''}>
              Gemini 2.0 Flash (30 credits/page) ⚡ Fast & Affordable
            </option>
            <option value="anthropic-sonnet-3.5" ${this.currentConfig.parseModel === 'anthropic-sonnet-3.5' ? 'selected' : ''}>
              Claude Sonnet 3.5 (45 credits/page) ⚖️ Balanced
            </option>
            <option value="openai-gpt-4-1" ${this.currentConfig.parseModel === 'openai-gpt-4-1' ? 'selected' : ''}>
              GPT-4.1 (45 credits/page) 🎯 High Quality
            </option>
            <option value="gemini-2.5-pro" ${this.currentConfig.parseModel === 'gemini-2.5-pro' ? 'selected' : ''}>
              Gemini 2.5 Pro (45 credits/page) ⭐ Recommended
            </option>
            <option value="anthropic-sonnet-4.0" ${this.currentConfig.parseModel === 'anthropic-sonnet-4.0' ? 'selected' : ''}>
              Claude Sonnet 4.0 (90 credits/page) 👑 Highest Quality
            </option>
          </select>
          <small class="form-text text-muted">
            Model used for AI-powered parsing. Credits are consumed per page processed.<br>
            <strong>Tip:</strong> Start with economical models for testing, use premium models for production.
          </small>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="highResOcr" ${this.currentConfig.highResOcr ? 'checked' : ''}>
            <span class="checkbox-text">Enable High-Resolution OCR</span>
          </label>
          <small class="form-text text-muted">Better text extraction from scanned documents (slower processing)</small>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="adaptiveLongTable" ${this.currentConfig.adaptiveLongTable ? 'checked' : ''}>
            <span class="checkbox-text">Adaptive Long Table Detection</span>
          </label>
          <small class="form-text text-muted">Intelligently handle tables that span multiple pages</small>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="outlinedTableExtraction" ${this.currentConfig.outlinedTableExtraction ? 'checked' : ''}>
            <span class="checkbox-text">Extract Outlined Tables</span>
          </label>
          <small class="form-text text-muted">Extract tables with visible borders and outlines</small>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="outputTablesAsHtml" ${this.currentConfig.outputTablesAsHtml ? 'checked' : ''}>
            <span class="checkbox-text">Output Tables as HTML</span>
          </label>
          <small class="form-text text-muted">Preserve table formatting in markdown output</small>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="multimodal" ${this.currentConfig.multimodal ? 'checked' : ''}>
            <span class="checkbox-text">Enable Multimodal Processing</span>
          </label>
          <small class="form-text text-muted">Extract and process images from documents</small>
        </div>

        <div class="form-actions">
          <button id="saveRagConfig" class="btn btn-primary">💾 Save Configuration</button>
          <button id="cancelRagEdit" class="btn btn-secondary">❌ Cancel</button>
        </div>

        <div class="validation-feedback" id="validationFeedback"></div>
      </div>
    `;
  }

  // Bind event listeners
  bindEvents() {
    // Edit button
    document.getElementById('editRagConfig')?.addEventListener('click', () => {
      this.enterEditMode();
    });

    // Test button
    document.getElementById('testRagConfig')?.addEventListener('click', () => {
      this.testConfiguration();
    });

    // Reset button
    document.getElementById('resetRagConfig')?.addEventListener('click', () => {
      this.resetToDefaults();
    });
  }

  // Enter edit mode
  enterEditMode() {
    this.isEditing = true;
    document.getElementById('configDisplay').style.display = 'none';
    document.getElementById('configEditor').style.display = 'block';
    document.getElementById('editRagConfig').style.display = 'none';
    document.getElementById('resetRagConfig').style.display = 'inline-block';

    // Bind editor events
    this.bindEditorEvents();
  }

  // Exit edit mode
  exitEditMode() {
    this.isEditing = false;
    document.getElementById('configDisplay').style.display = 'block';
    document.getElementById('configEditor').style.display = 'none';
    document.getElementById('editRagConfig').style.display = 'inline-block';
    document.getElementById('resetRagConfig').style.display = 'none';

    // Update display
    document.getElementById('configDisplay').innerHTML = this.renderConfigDisplay();
  }

  // Bind editor-specific events
  bindEditorEvents() {
    // Save button
    document.getElementById('saveRagConfig')?.addEventListener('click', () => {
      this.saveConfiguration();
    });

    // Cancel button
    document.getElementById('cancelRagEdit')?.addEventListener('click', () => {
      this.exitEditMode();
    });

    // Real-time validation and change tracking
    const inputs = ['chunkStrategy', 'chunkSize', 'chunkOverlap', 'multimodal', 'embeddingModel'];
    inputs.forEach(inputId => {
      const element = document.getElementById(inputId);
      if (element) {
        element.addEventListener('change', () => {
          this.validateConfiguration();
          this.checkForChanges(inputId);
          
          // Special handling for embedding model selection
          if (inputId === 'embeddingModel') {
            this.updateEmbeddingModelWarning(element.value);
          }
        });
        element.addEventListener('input', () => {
          this.validateConfiguration();
          this.checkForChanges(inputId);
        });
      }
    });
    
    // Show warning if text-embedding-3-large is already selected
    const embeddingModelSelect = document.getElementById('embeddingModel');
    if (embeddingModelSelect) {
      this.updateEmbeddingModelWarning(embeddingModelSelect.value);
    }
  }
  
  // Check if a setting has changed and update visual indicators
  checkForChanges(settingId) {
    const formConfig = this.getFormConfig();
    const hasChanged = formConfig[settingId] !== this.originalConfig[settingId];
    
    // Find the form group for this setting
    const formGroup = document.querySelector(`[data-setting="${settingId}"]`);
    if (formGroup && formGroup.classList.contains('requires-restart')) {
      if (hasChanged) {
        formGroup.classList.add('changed');
      } else {
        formGroup.classList.remove('changed');
      }
    }
    
    // Check if any restart-required settings have changed
    const anyRestartRequired = this.settingsRequiringRestart.some(setting => {
      return formConfig[setting] !== this.originalConfig[setting];
    });
    
    if (anyRestartRequired && window.showRestartNotification) {
      window.showRestartNotification();
    }
  }

  // Validate current configuration
  validateConfiguration() {
    const config = this.getFormConfig();
    const validation = DocumentUtils.validateRagConfig(config);
    
    const feedbackElement = document.getElementById('validationFeedback');
    if (feedbackElement) {
      if (validation.isValid) {
        feedbackElement.innerHTML = '<div class="validation-success">✅ Configuration is valid</div>';
      } else {
        feedbackElement.innerHTML = `
          <div class="validation-errors">
            <div class="error-title">❌ Configuration Errors:</div>
            ${validation.errors.map(error => `<div class="error-item">${error}</div>`).join('')}
          </div>
        `;
      }
    }

    return validation.isValid;
  }

  // Get configuration from form
  getFormConfig() {
    return {
      chunkStrategy: document.getElementById('chunkStrategy')?.value || 'sentence',
      chunkSize: parseInt(document.getElementById('chunkSize')?.value) || 1500,
      chunkOverlap: parseInt(document.getElementById('chunkOverlap')?.value) || 100,
      multimodal: document.getElementById('multimodal')?.checked || false,
      embeddingModel: document.getElementById('embeddingModel')?.value || 'text-embedding-3-small',
      // Advanced parsing options
      parseMode: document.getElementById('parseMode')?.value || 'parse_page_with_agent',
      parseModel: document.getElementById('parseModel')?.value || 'gemini-2.5-pro',
      highResOcr: document.getElementById('highResOcr')?.checked || true,
      adaptiveLongTable: document.getElementById('adaptiveLongTable')?.checked || true,
      outlinedTableExtraction: document.getElementById('outlinedTableExtraction')?.checked || true,
      outputTablesAsHtml: document.getElementById('outputTablesAsHtml')?.checked || true
    };
  }

  // Save configuration to server
  async saveConfiguration() {
    if (!this.validateConfiguration()) {
      return;
    }

    const newConfig = this.getFormConfig();
    
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          config: {
            LLAMACLOUD_CHUNK_STRATEGY: newConfig.chunkStrategy,
            LLAMACLOUD_CHUNK_SIZE: newConfig.chunkSize.toString(),
            LLAMACLOUD_CHUNK_OVERLAP: newConfig.chunkOverlap.toString(),
            LLAMACLOUD_MULTIMODAL_PARSING: newConfig.multimodal.toString(),
            OPENAI_EMBEDDING_MODEL: newConfig.embeddingModel,
            // Advanced parsing options
            LLAMACLOUD_PARSE_MODE: newConfig.parseMode,
            LLAMACLOUD_PARSE_MODEL: newConfig.parseModel,
            LLAMACLOUD_HIGH_RES_OCR: newConfig.highResOcr.toString(),
            LLAMACLOUD_ADAPTIVE_LONG_TABLE: newConfig.adaptiveLongTable.toString(),
            LLAMACLOUD_OUTLINED_TABLE_EXTRACTION: newConfig.outlinedTableExtraction.toString(),
            LLAMACLOUD_OUTPUT_TABLES_AS_HTML: newConfig.outputTablesAsHtml.toString()
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to save configuration: ${response.statusText}`);
      }

      this.currentConfig = newConfig;
      this.originalConfig = {...newConfig}; // Update original config after successful save
      this.exitEditMode();
      this.notifyConfigChange();
      
      // Always show restart notification for these settings
      const anyChangedFromOriginal = this.settingsRequiringRestart.some(setting => {
        return newConfig[setting] !== this.originalConfig[setting];
      });
      
      if (anyChangedFromOriginal) {
        this.showNotification('Configuration saved successfully! ⚠️ Server restart required for changes to take effect.', 'warning');
        if (window.showRestartNotification) {
          window.showRestartNotification();
        }
      } else {
        this.showNotification('Configuration saved successfully!', 'success');
      }
      
    } catch (error) {
      console.error('Failed to save configuration:', error);
      this.showNotification('Failed to save configuration: ' + error.message, 'error');
    }
  }

  // Reset to default configuration
  resetToDefaults() {
    if (confirm('Reset RAG configuration to defaults? This will overwrite current settings.')) {
      this.currentConfig = {
        chunkStrategy: 'sentence',
        chunkSize: 1500,
        chunkOverlap: 100,
        multimodal: true,
        embeddingModel: 'text-embedding-3-small'
      };

      if (this.isEditing) {
        // Update form values
        document.getElementById('chunkStrategy').value = this.currentConfig.chunkStrategy;
        document.getElementById('chunkSize').value = this.currentConfig.chunkSize;
        document.getElementById('chunkOverlap').value = this.currentConfig.chunkOverlap;
        document.getElementById('multimodal').checked = this.currentConfig.multimodal;
        document.getElementById('embeddingModel').value = this.currentConfig.embeddingModel;
        
        // Update slider displays
        document.getElementById('chunkSizeValue').textContent = this.currentConfig.chunkSize;
        document.getElementById('chunkOverlapValue').textContent = this.currentConfig.chunkOverlap;
      } else {
        document.getElementById('configDisplay').innerHTML = this.renderConfigDisplay();
      }
      
      this.notifyConfigChange();
    }
  }

  // Utility methods
  estimateChunksPerPage() {
    const avgCharsPerPage = 2000; // Rough estimate
    return Math.round(avgCharsPerPage / this.currentConfig.chunkSize);
  }

  getModelInfo() {
    const models = {
      'openai-gpt-4-1-mini': { name: 'GPT-4.1 Mini', credits: 10, quality: 'Economical' },
      'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', credits: 30, quality: 'Fast' },
      'anthropic-sonnet-3.5': { name: 'Claude Sonnet 3.5', credits: 45, quality: 'Balanced' },
      'openai-gpt-4-1': { name: 'GPT-4.1', credits: 45, quality: 'High' },
      'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', credits: 45, quality: 'Recommended' },
      'anthropic-sonnet-4.0': { name: 'Claude Sonnet 4.0', credits: 90, quality: 'Premium' }
    };
    return models[this.currentConfig.parseModel] || models['gemini-2.5-pro'];
  }

  getModelDisplayName(modelId) {
    const models = {
      'openai-gpt-4-1-mini': { name: 'GPT-4.1 Mini', credits: 10, quality: 'Economical' },
      'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', credits: 30, quality: 'Fast' },
      'anthropic-sonnet-3.5': { name: 'Claude Sonnet 3.5', credits: 45, quality: 'Balanced' },
      'openai-gpt-4-1': { name: 'GPT-4.1', credits: 45, quality: 'High' },
      'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', credits: 45, quality: 'Recommended' },
      'anthropic-sonnet-4.0': { name: 'Claude Sonnet 4.0', credits: 90, quality: 'Premium' }
    };
    const modelInfo = models[modelId] || models['gemini-2.5-pro'];
    return `${modelInfo.name} (${modelInfo.credits} credits/page)`;
  }

  estimateCreditCost(pageCount = 10) {
    const modelInfo = this.getModelInfo();
    return modelInfo.credits * pageCount;
  }

  getProcessingComplexity() {
    let complexity = 'Low';
    let features = [];
    
    // Base complexity from chunk size
    if (this.currentConfig.chunkSize < 500) complexity = 'High';
    else if (this.currentConfig.chunkSize < 1000) complexity = 'Medium';
    
    // Increase complexity for advanced features
    if (this.currentConfig.parseMode === 'parse_page_with_agent') {
      complexity = 'High';
      features.push('AI Agent');
    }
    
    if (this.currentConfig.highResOcr) {
      features.push('High-Res OCR');
      if (complexity === 'Low') complexity = 'Medium';
    }
    
    if (this.currentConfig.multimodal) features.push('Images');
    if (this.currentConfig.adaptiveLongTable) features.push('Long Tables');
    
    // Add features to complexity string
    if (features.length > 0) {
      complexity += ` (${features.join(', ')})`;
    }
    
    return complexity;
  }

  // Event management
  onConfigChange(callback) {
    this.callbacks.push(callback);
  }

  notifyConfigChange() {
    this.callbacks.forEach(callback => {
      try {
        callback(this.currentConfig);
      } catch (error) {
        console.error('Error in config change callback:', error);
      }
    });
  }

  // Show notification
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        ${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'} ${message}
      </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000); // Show for 5 seconds for warning messages
  }

  // Test configuration
  async testConfiguration() {
    const testBtn = document.getElementById('testRagConfig');
    const originalText = testBtn.textContent;
    
    try {
      // Show loading state
      testBtn.disabled = true;
      testBtn.textContent = '🔄 Testing...';
      
      const response = await fetch('/api/config/test-rag');
      const result = await response.json();
      
      if (result.status === 'success') {
        // Show test results in a modal or alert
        const message = `
RAG Configuration Test Results:
━━━━━━━━━━━━━━━━━━━━━━━━
📊 Document Stats:
• Documents: ${result.stats.documentCount}
• Chunks: ${result.stats.chunkCount}
• Avg chunk size: ${result.stats.avgChunkSize} chars
• Chunks per doc: ${result.stats.chunksPerDoc}

⚙️ Current Settings:
• Strategy: ${result.config.chunkStrategy}
• Chunk size: ${result.config.chunkSize}
• Overlap: ${result.config.chunkOverlap}
• Model: ${result.config.embeddingModel}

🧪 Embedding Test: ${result.embeddingTest.success ? '✅ Success' : '❌ Failed'}
${result.embeddingTest.success ? `• Model: ${result.embeddingTest.model}\n• Dimensions: ${result.embeddingTest.dimensions}` : `• Error: ${result.embeddingTest.error}`}

💡 Recommendations:
${result.recommendations.map(r => `• ${r}`).join('\n')}
        `;
        
        alert(message);
      } else {
        throw new Error(result.error || 'Test failed');
      }
    } catch (error) {
      console.error('Test configuration error:', error);
      this.showNotification('Failed to test configuration: ' + error.message, 'error');
    } finally {
      // Restore button
      testBtn.disabled = false;
      testBtn.textContent = originalText;
    }
  }

  // Update embedding model warning visibility
  updateEmbeddingModelWarning(selectedModel) {
    const warningElement = document.getElementById('embeddingModelWarning');
    if (warningElement) {
      if (selectedModel === 'text-embedding-3-large') {
        warningElement.classList.remove('hidden');
      } else {
        warningElement.classList.add('hidden');
      }
    }
  }
  
  // Get current configuration
  getConfig() {
    return this.currentConfig;
  }
}

// Export for use in config UI
window.RagConfigManager = RagConfigManager;

console.log('RAG config manager script loaded'); 