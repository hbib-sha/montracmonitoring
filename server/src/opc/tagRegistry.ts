/**
 * tagRegistry — resolves logical tag names to their OPC UA node IDs.
 * Populated from the database on boot. Provides a fast in-memory lookup
 * for the monitoring engine's polling loop.
 */
import { tagRepo } from '../db/repositories/tagRepo';
import type { TagDef } from '../types';

class TagRegistry {
  private byName = new Map<string, TagDef>();
  private byId   = new Map<number, TagDef>();

  /** Load / reload tags from the database. */
  reload(): void {
    this.byName.clear();
    this.byId.clear();
    for (const tag of tagRepo.getAll()) {
      this.byName.set(tag.logicalName, tag);
      this.byId.set(tag.id, tag);
    }
  }

  getByName(name: string): TagDef | undefined {
    return this.byName.get(name);
  }

  getById(id: number): TagDef | undefined {
    return this.byId.get(id);
  }

  /** All registered tags (snapshot). */
  getAll(): TagDef[] {
    return [...this.byName.values()];
  }

  /** Convenience: resolve tag id → node ID string. */
  nodeIdFor(tagId: number | undefined | null): string | undefined {
    if (tagId == null) return undefined;
    return this.byId.get(tagId)?.nodeId;
  }
}

export const tagRegistry = new TagRegistry();
