/**
 * AudioStatsBar component for displaying audio statistics.
 *
 * Shows:
 * - Total transmissions
 * - Transcribed count
 * - Pending count
 * - Total duration
 * - Radio status
 */

import React from 'react';
import { FileAudio, CheckCircle, Clock, Mic, Radio } from 'lucide-react';

function AudioStatsBar({ statsData, statusData }) {
  return (
    <div className="audio-stats-bar">
      <div className="audio-stat">
        <FileAudio size={16} />
        <span className="stat-value">{statsData?.total_transmissions || 0}</span>
        <span className="stat-label">Total</span>
      </div>
      <div className="audio-stat">
        <CheckCircle size={16} className="text-green" />
        <span className="stat-value">{statsData?.total_transcribed || 0}</span>
        <span className="stat-label">Transcribed</span>
      </div>
      <div className="audio-stat">
        <Clock size={16} className="text-yellow" />
        <span className="stat-value">{statsData?.pending_transcription || 0}</span>
        <span className="stat-label">Pending</span>
      </div>
      <div className="audio-stat">
        <Mic size={16} className="text-cyan" />
        <span className="stat-value">{statsData?.total_duration_hours?.toFixed(1) || 0}h</span>
        <span className="stat-label">Duration</span>
      </div>
      <div className="audio-stat">
        <Radio size={16} />
        <span className={`stat-value ${statusData?.radio_enabled ? 'text-green' : 'text-red'}`}>
          {statusData?.radio_enabled ? 'Active' : 'Disabled'}
        </span>
        <span className="stat-label">Radio</span>
      </div>
    </div>
  );
}

export default AudioStatsBar;
