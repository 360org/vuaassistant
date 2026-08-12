/**
 * Inherited from NanoClaw's destination-map core, adapted to VuaAssistant's
 * inbound IPC schema. The host owns this map; the runner only reads it.
 */
import { getInboundDb } from './db/connection.js';

export interface DestinationEntry {
  name: string;
  displayName: string;
  type: 'channel' | 'agent';
  channelType?: string;
  platformId?: string;
  agentGroupId?: string;
}

interface DestinationRow {
  name: string;
  type: 'channel' | 'agent';
  channel_type: string | null;
  platform_id: string | null;
  metadata: string | null;
}

function toEntry(row: DestinationRow): DestinationEntry {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata || '{}') as Record<string, unknown>; } catch { /* legacy row */ }
  return {
    name: row.name,
    displayName: typeof metadata.displayName === 'string' ? metadata.displayName : row.name,
    type: row.type,
    channelType: row.channel_type || undefined,
    platformId: row.platform_id || undefined,
    agentGroupId: typeof metadata.agentGroupId === 'string' ? metadata.agentGroupId : undefined,
  };
}

export function getAllDestinations(): DestinationEntry[] {
  return (getInboundDb().prepare('SELECT name, type, channel_type, platform_id, metadata FROM destinations ORDER BY name').all() as DestinationRow[])
    .map(toEntry);
}

export function findByName(name: string): DestinationEntry | undefined {
  const row = getInboundDb()
    .prepare('SELECT name, type, channel_type, platform_id, metadata FROM destinations WHERE name = ?')
    .get(name) as DestinationRow | undefined;
  return row ? toEntry(row) : undefined;
}
