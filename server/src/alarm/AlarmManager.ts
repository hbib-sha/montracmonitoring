/**
 * AlarmManager — handles:
 *  - Light tower continuous blink while connected
 *  - Crash → buzzer on + progressive alarm state
 *  - Auto-off timer (default 30 s)
 *  - Push Button 1 input → acknowledge
 *  - Web acknowledge command
 *  - Emit 'alarmChanged' so WebSocket gateway can broadcast
 */
import { EventEmitter } from 'events';
import type { PlcDriver } from '../opc/PlcDriver';
import type { AlarmInfo, AlarmState, SegmentRecoveredPayload } from '../types';
import type { CrashPayload } from '../monitoring/crashDetection';
import pino from 'pino';

const logger = pino({ name: 'AlarmManager' });

export declare interface AlarmManager {
  on(event: 'alarmChanged', listener: (info: AlarmInfo) => void): this;
}

export class AlarmManager extends EventEmitter {
  private alarm: AlarmInfo = { state: 'idle' };
  private autoOffTimer: ReturnType<typeof setTimeout> | null = null;
  private lightTowerTimer: ReturnType<typeof setInterval> | null = null;
  private pushButtonTimer: ReturnType<typeof setInterval> | null = null;
  private lightTowerState = false;

  constructor(
    private driver: PlcDriver,
    private config: {
      alarmAutoOffMs: number;
      lightTowerNodeId: string;
      buzzerNodeId: string;
      pushButton1NodeId: string;
      lightTowerBlinkMs: number;
    },
  ) {
    super();
  }

  /** Start light-tower blink and push-button poll. */
  startOnlineIndicator(): void {
    // Light tower blink
    if (this.config.lightTowerNodeId) {
      this.lightTowerTimer = setInterval(async () => {
        if (!this.driver.isConnected) return;
        this.lightTowerState = !this.lightTowerState;
        await this.driver.write(this.config.lightTowerNodeId, this.lightTowerState);
      }, this.config.lightTowerBlinkMs);
    }

    // Push Button 1 poll (100ms — same as PLC poll)
    if (this.config.pushButton1NodeId) {
      let lastPBState = false;
      this.pushButtonTimer = setInterval(async () => {
        if (!this.driver.isConnected || this.alarm.state !== 'active') return;
        const val = await this.driver.read(this.config.pushButton1NodeId);
        const pressed = Boolean(val);
        if (!lastPBState && pressed) {
          logger.info('Push Button 1 — acknowledging alarm');
          this.acknowledge();
        }
        lastPBState = pressed;
      }, 200);
    }
  }

  stopOnlineIndicator(): void {
    if (this.lightTowerTimer) {
      clearInterval(this.lightTowerTimer);
      this.lightTowerTimer = null;
    }
    if (this.config.lightTowerNodeId && this.driver.isConnected) {
      this.driver.write(this.config.lightTowerNodeId, false).catch(() => { /* ignore */ });
    }
    this.lightTowerState = false;
  }

  stopAll(): void {
    this.stopOnlineIndicator();
    if (this.pushButtonTimer) {
      clearInterval(this.pushButtonTimer);
      this.pushButtonTimer = null;
    }
    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
      this.autoOffTimer = null;
    }
  }

  /** Update config when settings change. */
  updateConfig(cfg: Partial<typeof this.config>): void {
    Object.assign(this.config, cfg);
  }

  onCrash(payload: CrashPayload): void {
    if (this.alarm.state === 'active') return; // already alarming

    const now = Date.now();
    this.alarm = {
      state:       'active' as AlarmState,
      loopId:      payload.loopId,
      segmentFrom: payload.fromIndex,
      segmentTo:   payload.toIndex,
      startedAtMs: now,
      autoOffAtMs: now + this.config.alarmAutoOffMs,
    };

    logger.warn({ payload }, 'ALARM: crash detected');

    // Buzzer on
    if (this.config.buzzerNodeId && this.driver.isConnected) {
      this.driver.write(this.config.buzzerNodeId, true).catch(() => { /* ignore */ });
    }

    // Auto-off timer
    this.autoOffTimer = setTimeout(() => {
      logger.info('Alarm auto-off');
      this.clearAlarm();
    }, this.config.alarmAutoOffMs);

    this.emit('alarmChanged', { ...this.alarm });
  }

  acknowledge(): void {
    if (this.alarm.state !== 'active') return;
    this.clearAlarm();
    logger.info('Alarm acknowledged');
  }

  /**
   * Auto-clear the alarm when a delayed shuttle recovers (false alarm).
   * Only clears if the active alarm is for the recovered loop AND that loop has
   * no crashed segments left — so a multi-crash loop keeps alarming until the
   * last segment resolves.
   */
  onRecovery(payload: SegmentRecoveredPayload): void {
    if (this.alarm.state !== 'active') return;
    if (this.alarm.loopId !== payload.loopId) return;
    if (payload.remainingCrashes > 0) return;
    logger.info({ loopId: payload.loopId }, 'Alarm auto-cleared — shuttle recovered (false alarm)');
    this.clearAlarm();
  }

  getState(): AlarmInfo {
    return { ...this.alarm };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private clearAlarm(): void {
    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
      this.autoOffTimer = null;
    }

    // Buzzer off
    if (this.config.buzzerNodeId && this.driver.isConnected) {
      this.driver.write(this.config.buzzerNodeId, false).catch(() => { /* ignore */ });
    }

    this.alarm = { state: 'idle' };
    this.emit('alarmChanged', { ...this.alarm });
  }
}
