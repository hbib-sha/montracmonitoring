/**
 * OpcUaDriver — real OPC UA connection using node-opcua.
 * Lifted from the proven pattern in reference/test-web-opc.js.
 */
import {
  OPCUAClient,
  AttributeIds,
  DataType,
  StatusCodes,
  type ClientSession,
  type OPCUAClientOptions,
} from 'node-opcua';
import type { PlcDriver } from './PlcDriver';
import pino from 'pino';

const logger = pino({ name: 'OpcUaDriver' });

export class OpcUaDriver implements PlcDriver {
  private client: ReturnType<typeof OPCUAClient.create>;
  private session: ClientSession | null = null;
  private _connected = false;

  constructor(private endpoint: string) {
    const opts: OPCUAClientOptions = {
      endpointMustExist: false,
      connectionStrategy: {
        maxRetry: Infinity,
        initialDelay: 1000,
        maxDelay: 10000,
      },
    };
    this.client = OPCUAClient.create(opts);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = this.client as any;
    c.on('connection_lost', () => {
      this._connected = false;
      this.session = null;
      logger.warn('OPC UA connection lost — will reconnect');
    });
    c.on('start_reconnection', () => {
      logger.info('OPC UA reconnecting...');
    });
    c.on('connection_reestablished', async () => {
      logger.info('OPC UA reconnected — recreating session');
      try {
        this.session = await this.client.createSession();
        this._connected = true;
        logger.info('OPC UA session recreated');
      } catch (e) {
        logger.error({ err: e }, 'Failed to recreate session after reconnect');
      }
    });
  }

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    logger.info({ endpoint: this.endpoint }, 'Connecting to OPC UA');
    await this.client.connect(this.endpoint);
    this.session = await this.client.createSession();
    this._connected = true;
    logger.info('OPC UA connected and session created');
  }

  async read(nodeId: string): Promise<boolean | number | string | undefined> {
    if (!this.session) return undefined;
    try {
      const dv = await this.session.readVariableValue(nodeId);
      if (dv.statusCode !== StatusCodes.Good) return undefined;
      return dv.value.value as boolean | number | string;
    } catch {
      return undefined;
    }
  }

  async readMany(
    nodeIds: string[],
  ): Promise<Record<string, boolean | number | string>> {
    if (!this.session || nodeIds.length === 0) return {};
    try {
      const nodesToRead = nodeIds.map((id) => ({
        nodeId: id,
        attributeId: AttributeIds.Value,
      }));
      const results = await this.session.read(nodesToRead);
      const out: Record<string, boolean | number | string> = {};
      results.forEach((dv, i) => {
        if (dv.statusCode === StatusCodes.Good && dv.value?.value !== undefined) {
          out[nodeIds[i]] = dv.value.value as boolean | number | string;
        }
      });
      return out;
    } catch {
      return {};
    }
  }

  async write(nodeId: string, value: boolean | number): Promise<boolean> {
    return this.writeMany([{ nodeId, value }]);
  }

  async writeMany(
    entries: Array<{ nodeId: string; value: boolean | number }>,
  ): Promise<boolean> {
    if (!this.session || entries.length === 0) return false;
    try {
      const nodesToWrite = entries.map(({ nodeId, value }) => ({
        nodeId,
        attributeId: AttributeIds.Value,
        value: {
          value: {
            dataType: typeof value === 'boolean' ? DataType.Boolean : DataType.Int32,
            value,
          },
        },
      }));
      const statusCodes = await this.session.write(nodesToWrite);
      return statusCodes.every((sc) => sc === StatusCodes.Good || sc.name === 'Good');
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    try {
      if (this.session) await this.session.close();
    } catch { /* ignore */ }
    try {
      await this.client.disconnect();
    } catch { /* ignore */ }
    this._connected = false;
    this.session = null;
  }
}
