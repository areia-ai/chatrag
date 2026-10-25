import { supabaseAdmin } from './supabase';

export type ToolExecutionStatus = 'pending' | 'approved' | 'running' | 'completed' | 'error' | 'cancelled';

export interface ToolExecutionState {
  id: string;
  chat_id: string;
  message_id: number;
  tool_call_id: string;
  tool_name: string;
  status: ToolExecutionStatus;
  tool_params?: any;
  tool_result?: any;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateToolExecutionStateParams {
  chat_id: string;
  message_id: number;
  tool_call_id: string;
  tool_name: string;
  tool_params?: any;
}

export interface UpdateToolExecutionStateParams {
  status?: ToolExecutionStatus;
  tool_result?: any;
  error_message?: string;
  tool_params?: any;
}

export class ToolExecutionStateService {
  /**
   * Create a new tool execution state record
   */
  static async create(params: CreateToolExecutionStateParams): Promise<ToolExecutionState | null> {
    try {
      console.log('[ToolExecutionState] Creating new state:', params);
      
      const { data, error } = await supabaseAdmin!
        .from('tool_execution_states')
        .insert({
          chat_id: params.chat_id,
          message_id: params.message_id,
          tool_call_id: params.tool_call_id,
          tool_name: params.tool_name,
          status: 'pending' as ToolExecutionStatus,
          tool_params: params.tool_params
        })
        .select()
        .single();

      if (error) {
        console.error('[ToolExecutionState] Error creating state:', error);
        return null;
      }

      console.log('[ToolExecutionState] Created state:', data);
      return data;
    } catch (error) {
      console.error('[ToolExecutionState] Exception creating state:', error);
      return null;
    }
  }

  /**
   * Get tool execution state by tool call ID
   * Returns the most recent state if multiple exist
   */
  static async getByToolCallId(tool_call_id: string): Promise<ToolExecutionState | null> {
    try {
      const { data, error } = await supabaseAdmin!
        .from('tool_execution_states')
        .select('*')
        .eq('tool_call_id', tool_call_id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('[ToolExecutionState] Error getting state by tool call ID:', error);
        return null;
      }

      if (!data || data.length === 0) {
        // No rows found - this is normal for new tool calls
        return null;
      }

      // Return the most recent state
      return data[0];
    } catch (error) {
      console.error('[ToolExecutionState] Exception getting state by tool call ID:', error);
      return null;
    }
  }

  /**
   * Get all tool execution states for a chat
   */
  static async getByChatId(chat_id: string): Promise<ToolExecutionState[]> {
    try {
      const { data, error } = await supabaseAdmin!
        .from('tool_execution_states')
        .select('*')
        .eq('chat_id', chat_id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[ToolExecutionState] Error getting states by chat ID:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[ToolExecutionState] Exception getting states by chat ID:', error);
      return [];
    }
  }

  /**
   * Get all tool execution states for a specific message
   */
  static async getByMessageId(chat_id: string, message_id: number): Promise<ToolExecutionState[]> {
    try {
      const { data, error } = await supabaseAdmin!
        .from('tool_execution_states')
        .select('*')
        .eq('chat_id', chat_id)
        .eq('message_id', message_id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[ToolExecutionState] Error getting states by message ID:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[ToolExecutionState] Exception getting states by message ID:', error);
      return [];
    }
  }

  /**
   * Update tool execution state
   */
  static async update(tool_call_id: string, updates: UpdateToolExecutionStateParams): Promise<ToolExecutionState | null> {
    try {
      console.log('[ToolExecutionState] Updating state for tool call:', tool_call_id);
      
      if (updates.tool_params) {
        console.log('[ToolExecutionState] Updating with', Object.keys(updates.tool_params).length, 'parameters');
      }
      
      const { data, error } = await supabaseAdmin!
        .from('tool_execution_states')
        .update(updates)
        .eq('tool_call_id', tool_call_id)
        .select()
        .single();

      if (error) {
        console.error('[ToolExecutionState] Error updating state:', error);
        return null;
      }

      console.log('[ToolExecutionState] Successfully updated state');
      return data;
    } catch (error) {
      console.error('[ToolExecutionState] Exception updating state:', error);
      return null;
    }
  }

  /**
   * Mark tool as approved and running
   */
  static async approve(tool_call_id: string): Promise<ToolExecutionState | null> {
    return this.update(tool_call_id, { status: 'approved' });
  }

  /**
   * Mark tool as running
   */
  static async markRunning(tool_call_id: string): Promise<ToolExecutionState | null> {
    return this.update(tool_call_id, { status: 'running' });
  }

  /**
   * Mark tool as completed with result
   */
  static async markCompleted(tool_call_id: string, result: any): Promise<ToolExecutionState | null> {
    return this.update(tool_call_id, { 
      status: 'completed', 
      tool_result: result 
    });
  }

  /**
   * Mark tool as failed with error
   */
  static async markError(tool_call_id: string, error_message: string): Promise<ToolExecutionState | null> {
    return this.update(tool_call_id, { 
      status: 'error', 
      error_message 
    });
  }

  /**
   * Mark tool as cancelled
   */
  static async markCancelled(tool_call_id: string): Promise<ToolExecutionState | null> {
    return this.update(tool_call_id, { status: 'cancelled' });
  }

  /**
   * Delete tool execution state (cleanup)
   */
  static async delete(tool_call_id: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin!
        .from('tool_execution_states')
        .delete()
        .eq('tool_call_id', tool_call_id);

      if (error) {
        console.error('[ToolExecutionState] Error deleting state:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[ToolExecutionState] Exception deleting state:', error);
      return false;
    }
  }

  /**
   * Create or update tool execution state (upsert)
   */
  static async upsert(params: CreateToolExecutionStateParams & UpdateToolExecutionStateParams): Promise<ToolExecutionState | null> {
    try {
      console.log('[ToolExecutionState] Upserting state:', params);
      
      const { data, error } = await supabaseAdmin!
        .from('tool_execution_states')
        .upsert({
          chat_id: params.chat_id,
          message_id: params.message_id,
          tool_call_id: params.tool_call_id,
          tool_name: params.tool_name,
          status: params.status || 'pending',
          tool_params: params.tool_params,
          tool_result: params.tool_result,
          error_message: params.error_message
        }, {
          onConflict: 'chat_id,message_id,tool_call_id'
        })
        .select()
        .single();

      if (error) {
        console.error('[ToolExecutionState] Error upserting state:', error);
        return null;
      }

      console.log('[ToolExecutionState] Upserted state:', data);
      return data;
    } catch (error) {
      console.error('[ToolExecutionState] Exception upserting state:', error);
      return null;
    }
  }
} 