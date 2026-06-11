import { db } from '../index';
import type { TagDef, TagDataType, TagDirection } from '../../types';

type TagRow = {
  id: number;
  logical_name: string;
  node_id: string;
  data_type: string;
  direction: string;
  description: string;
};

function mapRow(r: TagRow): TagDef {
  return {
    id:          r.id,
    logicalName: r.logical_name,
    nodeId:      r.node_id,
    dataType:    r.data_type as TagDataType,
    direction:   r.direction as TagDirection,
    description: r.description,
  };
}

export const tagRepo = {
  getAll(): TagDef[] {
    return (db.prepare('SELECT * FROM tags ORDER BY id').all() as TagRow[]).map(mapRow);
  },

  getById(id: number): TagDef | undefined {
    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
    return row ? mapRow(row) : undefined;
  },

  getByLogicalName(name: string): TagDef | undefined {
    const row = db.prepare('SELECT * FROM tags WHERE logical_name = ?').get(name) as TagRow | undefined;
    return row ? mapRow(row) : undefined;
  },

  upsert(tag: Omit<TagDef, 'id'>): number {
    const result = db.prepare(
      `INSERT INTO tags (logical_name, node_id, data_type, direction, description)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(logical_name) DO UPDATE SET
         node_id     = excluded.node_id,
         data_type   = excluded.data_type,
         direction   = excluded.direction,
         description = excluded.description`,
    ).run(tag.logicalName, tag.nodeId, tag.dataType, tag.direction, tag.description);
    return result.lastInsertRowid as number;
  },
};
