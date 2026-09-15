import { sql } from '../../db/client.js';

export interface ChannelRow { id: string; tenant_id: string; type: string; slug: string; name: string; public_key: string | null; enabled: boolean; draft_config: any; published_config: any; version: number }

export async function getChannelByKey(key: string): Promise<ChannelRow | null> {
  const [ch] = await sql<ChannelRow[]>`SELECT * FROM channels WHERE public_key = ${key} LIMIT 1`;
  return ch ?? null;
}
export async function getChannel(tenantId: string, type: string, slug: string): Promise<ChannelRow | null> {
  const [ch] = await sql<ChannelRow[]>`SELECT * FROM channels WHERE tenant_id = ${tenantId} AND type = ${type} AND slug = ${slug} LIMIT 1`;
  return ch ?? null;
}
export function publishedConfig(ch: ChannelRow): any { return ch.published_config && Object.keys(ch.published_config).length ? ch.published_config : ch.draft_config; }

export async function publishChannel(channelId: string, publishedBy: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [ch] = await tx<ChannelRow[]>`SELECT * FROM channels WHERE id = ${channelId}`;
    const version = ch.version + 1;
    await tx`UPDATE channels SET published_config = draft_config, version = ${version}, published_at = now(), updated_at = now() WHERE id = ${channelId}`;
    await tx`INSERT INTO channel_versions (channel_id, version, config, published_by) VALUES (${channelId}, ${version}, ${sql.json(ch.draft_config)}, ${publishedBy})`;
  });
}
