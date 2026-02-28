import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../db/database.service';

type JsonMap = Record<string, unknown>;

@Injectable()
export class IdempotencyService {
  constructor(private readonly db: DatabaseService) {}

  async execute<T extends JsonMap>(
    tenantId: string,
    key: string,
    payload: JsonMap,
    handler: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const requestHash = this.hashPayload(payload);

    return this.db.withTransaction(async (client) => {
      const existing = await client.query<{ request_hash: string; response_payload: T }>(
        `select request_hash, response_payload
         from idempotency_keys
         where tenant_id = $1 and key = $2
         for update`,
        [tenantId, key]
      );

      if (existing.rowCount && existing.rows[0].request_hash === requestHash) {
        return existing.rows[0].response_payload;
      }

      if (existing.rowCount && existing.rows[0].request_hash !== requestHash) {
        throw new Error('Idempotency key reused with different payload');
      }

      const response = await handler(client);

      await client.query(
        `insert into idempotency_keys (tenant_id, key, request_hash, response_payload)
         values ($1, $2, $3, $4::jsonb)`,
        [tenantId, key, requestHash, JSON.stringify(response)]
      );

      return response;
    });
  }

  private hashPayload(payload: JsonMap): string {
    const normalized = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash('sha256').update(normalized).digest('hex');
  }
}
