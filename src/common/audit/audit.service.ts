import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async log(actorId: string | null, action: string, entityType: string, entityId: string | null, payload: Record<string, unknown>) {
    await this.db.query(
      `insert into audit_logs (tenant_id, actor_id, action, entity_type, entity_id, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [payload.tenant_id ?? null, actorId, action, entityType, entityId, JSON.stringify(payload)]
    );
  }
}
