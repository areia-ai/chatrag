import { supabaseAdmin } from '@/lib/supabase';
import { getWhatsAppClient } from './client-factory';
import { WhatsAppSession, WhatsAppError, WhatsAppErrorCodes } from './types';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

/**
 * Manages WhatsApp sessions for users with automatic reconnection
 */
export class WhatsAppSessionManager {
  private whatsappClient = getWhatsAppClient();
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 1000; // Start with 1 second

  /**
   * Create a new WhatsApp session for a user
   */
  async createSession(userId: string): Promise<WhatsAppSession> {
    logger.info('WhatsAppSessionManager', `Creating session for user: ${userId}`);

    // Check if user already has an active session
    const existingSession = await this.getActiveSession(userId);
    if (existingSession) {
      throw new WhatsAppError(
        'User already has an active WhatsApp session',
        WhatsAppErrorCodes.SESSION_EXISTS,
        409
      );
    }

    // Check session limit
    const sessionCount = await this.getUserSessionCount(userId);
    const maxSessions = parseInt(env.WHATSAPP_MAX_SESSIONS_PER_USER || '1');
    
    if (sessionCount >= maxSessions) {
      throw new WhatsAppError(
        `Maximum number of sessions (${maxSessions}) reached`,
        WhatsAppErrorCodes.RATE_LIMIT_EXCEEDED,
        429
      );
    }

    try {
      // Clean up any existing sessions with empty phone numbers
      await supabaseAdmin
        .from('whatsapp_sessions')
        .delete()
        .eq('user_id', userId)
        .eq('phone_number', '');

      // Create session in WhatsApp provider
      const providerResponse = await this.whatsappClient.createSession(userId, {
        source: 'chatrag',
        timestamp: new Date().toISOString()
      });

      // Store session in database
      // Use session ID as temporary phone number to avoid constraint violations
      const { data: session, error } = await supabaseAdmin
        .from('whatsapp_sessions')
        .insert({
          user_id: userId,
          session_id: providerResponse.sessionId,
          status: 'qr_pending',
          qr_code: providerResponse.qrCode,
          qr_expires_at: providerResponse.expiresAt,
          phone_number: `pending_${providerResponse.sessionId}`, // Will be updated after connection
          koyeb_session_data: providerResponse
        })
        .select()
        .single();

      if (error) {
        logger.error('WhatsAppSessionManager', 'Failed to store session:', error);
        // Clean up Koyeb session
        await this.whatsappClient.disconnectSession(providerResponse.sessionId);
        throw error;
      }

      // Try to register webhook, but don't fail if it doesn't work (e.g., local testing)
      try {
        let webhookUrl = env.WHATSAPP_WEBHOOK_URL || `${env.NEXT_PUBLIC_SITE_URL}/api/whatsapp/webhook`;
        
        // Ensure webhook URL has the /api/whatsapp/webhook path
        if (webhookUrl && !webhookUrl.endsWith('/api/whatsapp/webhook')) {
          webhookUrl = `${webhookUrl}/api/whatsapp/webhook`;
        }
        
        await this.whatsappClient.registerWebhook(providerResponse.sessionId, webhookUrl);
        logger.info('WhatsAppSessionManager', `Webhook URL: ${webhookUrl}`);
        logger.info('WhatsAppSessionManager', 'Webhook registered successfully');
      } catch (webhookError) {
        logger.warn('WhatsAppSessionManager', 'Webhook registration failed (this is OK for local testing):', webhookError);
        // Continue without webhook - messages won't be received automatically
      }

      return this.mapToWhatsAppSession(session);
    } catch (error) {
      logger.error('WhatsAppSessionManager', 'Session creation failed:', error);
      throw error;
    }
  }

  /**
   * Get active session for a user
   */
  async getActiveSession(userId: string): Promise<WhatsAppSession | null> {
    const { data: session, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['connecting', 'connected', 'qr_pending'])
      .single();

    if (error || !session) {
      return null;
    }

    return this.mapToWhatsAppSession(session);
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<WhatsAppSession[]> {
    const { data: sessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('WhatsAppSessionManager', 'Failed to fetch user sessions:', error);
      throw error;
    }

    return sessions.map(this.mapToWhatsAppSession);
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    sessionId: string,
    status: WhatsAppSession['status'],
    additionalData?: {
      phoneNumber?: string;
      qrCode?: string;
      qrExpiresAt?: string;
      error?: string;
    }
  ): Promise<void> {
    logger.info('WhatsAppSessionManager', `Updating session ${sessionId} status to: ${status}`);

    const updateData: any = { status };

    if (additionalData?.phoneNumber) {
      // Check if we need to handle duplicate phone numbers
      const currentSession = await this.getSessionById(sessionId);
      if (currentSession) {
        // Delete any other sessions for this user with the same phone number
        await supabaseAdmin
          .from('whatsapp_sessions')
          .delete()
          .eq('user_id', currentSession.userId)
          .eq('phone_number', additionalData.phoneNumber)
          .neq('session_id', sessionId);
      }
      
      updateData.phone_number = additionalData.phoneNumber;
    }
    if (additionalData?.qrCode) {
      updateData.qr_code = additionalData.qrCode;
    }
    if (additionalData?.qrExpiresAt) {
      updateData.qr_expires_at = additionalData.qrExpiresAt;
    }
    if (additionalData?.error) {
      updateData.koyeb_session_data = { error: additionalData.error };
    }

    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .update(updateData)
      .eq('session_id', sessionId);

    if (error) {
      logger.error('WhatsAppSessionManager', 'Failed to update session status:', error);
      throw error;
    }
  }

  /**
   * Get session by session ID
   */
  async getSessionById(sessionId: string): Promise<WhatsAppSession | null> {
    const { data: session, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !session) {
      return null;
    }

    return this.mapToWhatsAppSession(session);
  }

  /**
   * Refresh QR code for a session
   */
  async refreshQRCode(sessionId: string): Promise<{ qrCode: string; expiresAt: string }> {
    logger.info('WhatsAppSessionManager', `Refreshing QR code for session: ${sessionId}`);

    const session = await this.getSessionById(sessionId);
    if (!session) {
      throw new WhatsAppError(
        'Session not found',
        WhatsAppErrorCodes.SESSION_NOT_FOUND,
        404
      );
    }

    if (session.status !== 'qr_pending') {
      throw new WhatsAppError(
        'Session is not waiting for QR code',
        WhatsAppErrorCodes.INVALID_STATE,
        400
      );
    }

    const qrData = await this.whatsappClient.getQRCode(sessionId);

    await this.updateSessionStatus(sessionId, 'qr_pending', {
      qrCode: qrData.qrCode,
      qrExpiresAt: qrData.expiresAt
    });

    return qrData;
  }

  /**
   * Disconnect a session
   */
  async disconnectSession(sessionId: string, userId: string): Promise<void> {
    logger.info('WhatsAppSessionManager', `Disconnecting session: ${sessionId}`);

    // Verify session belongs to user
    const session = await this.getSessionById(sessionId);
    if (!session || session.userId !== userId) {
      throw new WhatsAppError(
        'Session not found or unauthorized',
        WhatsAppErrorCodes.UNAUTHORIZED,
        403
      );
    }

    // Disconnect from provider
    try {
      await this.whatsappClient.disconnectSession(sessionId);
    } catch (error: any) {
      // If session not found (404), it's already disconnected - treat as success
      if (error?.statusCode === 404 || error?.message?.includes('Session not found')) {
        logger.info('WhatsAppSessionManager', `Session ${sessionId} already disconnected on provider`);
      } else {
        logger.error('WhatsAppSessionManager', 'Failed to disconnect from provider:', error);
      }
    }

    // Update database
    await this.updateSessionStatus(sessionId, 'disconnected');
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    logger.info('WhatsAppSessionManager', 'Cleaning up expired sessions');

    // Find sessions with expired QR codes
    const { data: expiredSessions, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('status', 'qr_pending')
      .lt('qr_expires_at', new Date().toISOString());

    if (error) {
      logger.error('WhatsAppSessionManager', 'Failed to find expired sessions:', error);
      return;
    }

    for (const session of expiredSessions || []) {
      try {
        await this.updateSessionStatus(session.session_id, 'failed', {
          error: 'QR code expired'
        });
        await this.whatsappClient.disconnectSession(session.session_id);
      } catch (error) {
        logger.error('WhatsAppSessionManager', `Failed to cleanup session ${session.session_id}:`, error);
      }
    }
  }

  /**
   * Get user session count
   */
  private async getUserSessionCount(userId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['connecting', 'connected', 'qr_pending']);

    if (error) {
      logger.error('WhatsAppSessionManager', 'Failed to count user sessions:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Map database record to WhatsAppSession type
   */
  private mapToWhatsAppSession(record: any): WhatsAppSession {
    // Clean up temporary phone number for display
    const phoneNumber = record.phone_number?.startsWith('pending_')
      ? ''
      : record.phone_number;

    return {
      id: record.id,
      userId: record.user_id,
      phoneNumber: phoneNumber,
      sessionId: record.session_id,
      status: record.status,
      qrCode: record.qr_code,
      qrExpiresAt: record.qr_expires_at ? new Date(record.qr_expires_at) : undefined,
      koyebSessionData: record.koyeb_session_data,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at)
    };
  }

  /**
   * Handle session disconnection with automatic reconnection
   */
  async handleDisconnection(sessionId: string, reason?: string): Promise<void> {
    logger.warn('WhatsAppSessionManager', `Session disconnected: ${sessionId}, reason: ${reason}`);

    // Don't reconnect if it was a logout
    if (reason?.includes('logout') || reason?.includes('logged out')) {
      logger.info('WhatsAppSessionManager', 'Session logged out, not attempting reconnection');
      await this.updateSessionStatus(sessionId, 'disconnected');
      this.clearReconnectState(sessionId);
      return;
    }

    // Get current reconnect attempts
    const attempts = this.reconnectAttempts.get(sessionId) || 0;

    if (attempts >= this.maxReconnectAttempts) {
      logger.error('WhatsAppSessionManager', `Max reconnection attempts reached for session: ${sessionId}`);
      await this.updateSessionStatus(sessionId, 'failed', {
        error: `Connection lost after ${attempts} reconnection attempts`
      });
      this.clearReconnectState(sessionId);
      return;
    }

    // Update status to reconnecting
    await this.updateSessionStatus(sessionId, 'reconnecting' as any);

    // Calculate delay with exponential backoff
    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, attempts), 30000); // Max 30 seconds
    logger.info('WhatsAppSessionManager', `Attempting reconnection ${attempts + 1}/${this.maxReconnectAttempts} in ${delay}ms`);

    // Set up reconnection timer
    const timer = setTimeout(async () => {
      try {
        await this.attemptReconnection(sessionId);
      } catch (error) {
        logger.error('WhatsAppSessionManager', `Reconnection attempt failed for session ${sessionId}:`, error);
        // Try again
        this.handleDisconnection(sessionId, 'reconnection_failed');
      }
    }, delay);

    this.reconnectTimers.set(sessionId, timer);
    this.reconnectAttempts.set(sessionId, attempts + 1);
  }

  /**
   * Attempt to reconnect a session
   */
  private async attemptReconnection(sessionId: string): Promise<void> {
    logger.info('WhatsAppSessionManager', `Attempting to reconnect session: ${sessionId}`);

    const session = await this.getSessionById(sessionId);
    if (!session) {
      logger.error('WhatsAppSessionManager', `Session not found for reconnection: ${sessionId}`);
      return;
    }

    try {
      // Check if session is still valid on the provider
      const status = await this.whatsappClient.getSessionStatus(sessionId);

      if (status.isConnected) {
        logger.info('WhatsAppSessionManager', `Session ${sessionId} reconnected successfully`);
        await this.updateSessionStatus(sessionId, 'connected');
        this.clearReconnectState(sessionId);
      } else {
        // Try to restart the session
        logger.info('WhatsAppSessionManager', `Restarting session ${sessionId}`);

        // Re-register webhook
        let webhookUrl = env.WHATSAPP_WEBHOOK_URL || `${env.NEXT_PUBLIC_SITE_URL}/api/whatsapp/webhook`;
        if (webhookUrl && !webhookUrl.endsWith('/api/whatsapp/webhook')) {
          webhookUrl = `${webhookUrl}/api/whatsapp/webhook`;
        }

        await this.whatsappClient.registerWebhook(sessionId, webhookUrl);

        // Check status again
        const newStatus = await this.whatsappClient.getSessionStatus(sessionId);
        if (newStatus.isConnected) {
          await this.updateSessionStatus(sessionId, 'connected');
          this.clearReconnectState(sessionId);
        } else {
          // Still not connected, try again
          this.handleDisconnection(sessionId, 'still_disconnected');
        }
      }
    } catch (error) {
      logger.error('WhatsAppSessionManager', `Failed to reconnect session ${sessionId}:`, error);
      this.handleDisconnection(sessionId, 'error');
    }
  }

  /**
   * Clear reconnection state for a session
   */
  private clearReconnectState(sessionId: string): void {
    const timer = this.reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sessionId);
    }
    this.reconnectAttempts.delete(sessionId);
  }

  /**
   * Monitor session health
   */
  async monitorSessionHealth(sessionId: string): Promise<void> {
    try {
      const status = await this.whatsappClient.getSessionStatus(sessionId);

      if (!status.isConnected) {
        await this.handleDisconnection(sessionId, 'health_check_failed');
      }
    } catch (error) {
      logger.error('WhatsAppSessionManager', `Health check failed for session ${sessionId}:`, error);
      await this.handleDisconnection(sessionId, 'health_check_error');
    }
  }
}

// Singleton instance
let sessionManager: WhatsAppSessionManager | null = null;

export function getSessionManager(): WhatsAppSessionManager {
  if (!sessionManager) {
    sessionManager = new WhatsAppSessionManager();
  }
  return sessionManager;
}