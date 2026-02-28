import { IConnector, ConnectorParams } from './connector.interface';

/**
 * MockConnector: always approves operations.
 * Use for local development and integration tests.
 */
export class MockConnector implements IConnector {
  readonly provider = 'mock';

  async validateCashIn(params: ConnectorParams): Promise<void> {
    if (!params.externalReference) {
      throw new Error('mock: external_reference is required');
    }
  }

  async validateCashOut(params: ConnectorParams): Promise<void> {
    if (!params.externalReference) {
      throw new Error('mock: external_reference is required');
    }
  }
}
