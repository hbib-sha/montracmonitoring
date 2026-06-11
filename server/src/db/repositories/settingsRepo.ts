import { db } from '../index';
import type { Settings, PlcMode } from '../../types';

type Row = { key: string; value: string };

export const settingsRepo = {
  getAll(): Settings {
    const rows = db.prepare('SELECT key, value FROM settings').all() as Row[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      opcEndpoint:       map['opc_endpoint']          ?? 'opc.tcp://10.0.2.2:4845',
      mode:              (map['mode'] as PlcMode)      ?? 'simulation',
      alarmAutoOffMs:    parseInt(map['alarm_auto_off_ms'] ?? '30000', 10),
      avgSpeedMmPerSec:  parseInt(map['avg_speed_mm_per_sec'] ?? '200', 10),
      lightTowerNodeId:  map['light_tower_node_id']    ?? '',
      buzzerNodeId:      map['buzzer_node_id']         ?? '',
      pushButton1NodeId: map['push_button_1_node_id']  ?? '',
    };
  },

  set(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  },

  setMany(updates: Partial<Settings>): void {
    const keyMap: Record<keyof Settings, string> = {
      opcEndpoint:       'opc_endpoint',
      mode:              'mode',
      alarmAutoOffMs:    'alarm_auto_off_ms',
      avgSpeedMmPerSec:  'avg_speed_mm_per_sec',
      lightTowerNodeId:  'light_tower_node_id',
      buzzerNodeId:      'buzzer_node_id',
      pushButton1NodeId: 'push_button_1_node_id',
    };
    const upsert = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    );
    for (const [field, value] of Object.entries(updates) as [keyof Settings, unknown][]) {
      if (value !== undefined) {
        upsert.run(keyMap[field], String(value));
      }
    }
  },
};
