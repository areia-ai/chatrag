'use client';

import React from 'react';
import styles from './styles.module.css';

interface ConnectorStats {
  connected_users: number;
  last_sync: string | null;
  total_syncs: number;
  failed_syncs: number;
}

interface ConnectionStatsProps {
  stats: ConnectorStats;
}

export function ConnectionStats({ stats }: ConnectionStatsProps) {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return date.toLocaleDateString();
  };

  const successRate =
    stats.total_syncs > 0
      ? Math.round(((stats.total_syncs - stats.failed_syncs) / stats.total_syncs) * 100)
      : 0;

  return (
    <div className={styles.statsContainer}>
      <h4>Connection Statistics</h4>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Connected Users</span>
          <span className={styles.statValue}>{stats.connected_users}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Last Sync</span>
          <span className={styles.statValue}>{formatDate(stats.last_sync)}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Syncs</span>
          <span className={styles.statValue}>{stats.total_syncs}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Success Rate</span>
          <span className={`${styles.statValue} ${successRate < 100 ? styles.warning : ''}`}>
            {successRate}%
          </span>
        </div>
      </div>
    </div>
  );
}
