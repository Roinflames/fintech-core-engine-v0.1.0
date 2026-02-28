export type ConnectorParams = {
  tenantId: string;
  walletId: string;
  amount: string;
  currency: string;
  externalReference: string;
};

export interface IConnector {
  readonly provider: string;
  /** Validate that a cash_in from this provider is acceptable. Throws on rejection. */
  validateCashIn(params: ConnectorParams): Promise<void>;
  /** Validate that a cash_out to this provider is acceptable. Throws on rejection. */
  validateCashOut(params: ConnectorParams): Promise<void>;
}
