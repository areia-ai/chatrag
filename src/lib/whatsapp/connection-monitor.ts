import { getSessionManager } from './session-manager';
import { supabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';

/**
 * WhatsApp Connection Monitor
 * Monitors and maintains WhatsApp session health
 */
export class WhatsAppConnectionMonitor {
  private monitorInterval: NodeJS.Timeout | null = null;
  private sessionManager = getSessionManager();
  private checkInterval = 10000; // Check every 10 seconds (more aggressive)
  private isRunning = false;

  /**
   * Start monitoring all active WhatsApp sessions
   */
  start(): void {
    if (this.isRunning) {
      logger.info('WhatsAppConnectionMonitor', 'Monitor already running');
      return;
    }

    logger.info('WhatsAppConnectionMonitor', 'Starting connection monitor');
    this.isRunning = true;

    // Initial check
    this.checkAllSessions();

    // Set up periodic monitoring
    this.monitorInterval = setInterval(() => {
      this.checkAllSessions();
    }, this.checkInterval);

    // Clean up stale sessions on startup
    this.cleanupStaleSessions();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('WhatsAppConnectionMonitor', 'Stopping connection monitor');
    this.isRunning = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * Check all active sessions
   */
  private async checkAllSessions(): Promise<void> {
    try {
      // Get all active sessions from database
      const { data: sessions, error } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('*')
        .in('status', ['connected', 'connecting', 'qr_pending']);

      if (error) {
        logger.error('WhatsAppConnectionMonitor', 'Failed to fetch sessions:', error);
        return;
      }

      if (!sessions || sessions.length === 0) {
        logger.debug('WhatsAppConnectionMonitor', 'No active sessions to monitor');
        return;
      }

      logger.info('WhatsAppConnectionMonitor', `Checking ${sessions.length} active sessions`);

      // Check each session
      for (const session of sessions) {
        try {
          await this.checkSession(session);
        } catch (error) {
          logger.error('WhatsAppConnectionMonitor', `Failed to check session ${session.session_id}:`, error);
        }
      }
    } catch (error) {
      logger.error('WhatsAppConnectionMonitor', 'Failed to check sessions:', error);
    }
  }

  /**
   * Check individual session health
   */
  private async checkSession(session: any): Promise<void> {
    const { session_id: sessionId, status, updated_at } = session;

    // Skip recently updated sessions (within last 5 minutes)
    const lastUpdate = new Date(updated_at);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (lastUpdate > fiveMinutesAgo && status === 'connected') {
      logger.debug('WhatsAppConnectionMonitor', `Session ${sessionId} recently updated, skipping check`);
      return;
    }

    logger.debug('WhatsAppConnectionMonitor', `Checking session ${sessionId} health`);

    // Check session health
    await this.sessionManager.monitorSessionHealth(sessionId);
  }

  /**
   * Clean up stale and duplicate sessions
   */
  private async cleanupStaleSessions(): Promise<void> {
    try {
      logger.info('WhatsAppConnectionMonitor', 'Cleaning up stale sessions');

      // Remove duplicate "default" sessions
      const { data: defaultSessions, error: defaultError } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('id')
        .eq('session_id', 'default');

      if (!defaultError && defaultSessions && defaultSessions.length > 0) {
        logger.warn('WhatsAppConnectionMonitor', `Found ${defaultSessions.length} 'default' sessions, removing...`);

        const { error: deleteError } = await supabaseAdmin
          .from('whatsapp_sessions')
          .delete()
          .eq('session_id', 'default');

        if (!deleteError) {
          logger.info('WhatsAppConnectionMonitor', 'Removed default sessions');
        }
      }

      // Clean up sessions that have been disconnected for more than 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: staleSessions, error: staleError } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('session_id')
        .in('status', ['disconnected', 'failed'])
        .lt('updated_at', oneDayAgo);

      if (!staleError && staleSessions && staleSessions.length > 0) {
        logger.info('WhatsAppConnectionMonitor', `Found ${staleSessions.length} stale sessions, cleaning up...`);

        for (const session of staleSessions) {
          try {
            // Try to clean up on provider side
            await this.sessionManager.disconnectSession(session.session_id, 'system');
          } catch (error) {
            // Session might already be gone, continue
            logger.debug('WhatsAppConnectionMonitor', `Could not disconnect stale session ${session.session_id}:`, error);
          }
        }

        // Remove from database
        const { error: deleteError } = await supabaseAdmin
          .from('whatsapp_sessions')
          .delete()
          .in('status', ['disconnected', 'failed'])
          .lt('updated_at', oneDayAgo);

        if (!deleteError) {
          logger.info('WhatsAppConnectionMonitor', `Cleaned up ${staleSessions.length} stale sessions`);
        }
      }

      // Clean up orphaned conversations (no associated session)
      const { data: orphanedConversations, error: orphanError } = await supabaseAdmin
        .from('whatsapp_conversations')
        .select('id, session_id')
        .is('session_id', null);

      if (!orphanError && orphanedConversations && orphanedConversations.length > 0) {
        logger.warn('WhatsAppConnectionMonitor', `Found ${orphanedConversations.length} orphaned conversations`);

        const { error: deleteConvError } = await supabaseAdmin
          .from('whatsapp_conversations')
          .delete()
          .is('session_id', null);

        if (!deleteConvError) {
          logger.info('WhatsAppConnectionMonitor', 'Cleaned up orphaned conversations');
        }
      }
    } catch (error) {
      logger.error('WhatsAppConnectionMonitor', 'Failed to cleanup stale sessions:', error);
    }
  }

  /**
   * Force reconnect a specific session
   */
  async forceReconnect(sessionId: string): Promise<void> {
    logger.info('WhatsAppConnectionMonitor', `Force reconnecting session: ${sessionId}`);
    await this.sessionManager.handleDisconnection(sessionId, 'force_reconnect');
  }
}

// Singleton instance
let monitor: WhatsAppConnectionMonitor | null = null;

/**
 * Get or create connection monitor instance
 */
export function getConnectionMonitor(): WhatsAppConnectionMonitor {
  if (!monitor) {
    monitor = new WhatsAppConnectionMonitor();
  }
  return monitor;
}

/**
 * Start global connection monitoring
 * Call this when the application starts
 */
export function startGlobalMonitoring(): void {
  const monitor = getConnectionMonitor();
  monitor.start();
}

/**
 * Stop global connection monitoring
 * Call this when the application shuts down
 */
export function stopGlobalMonitoring(): void {
  const monitor = getConnectionMonitor();
  monitor.stop();
}