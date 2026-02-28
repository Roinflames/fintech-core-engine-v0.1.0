import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class TenantsService {
  constructor(private readonly db: DatabaseService) {}

  async createTenant(input: { name: string; country_code: string }) {
    const id = randomUUID();
    await this.db.query(
      `insert into tenants (id, name, country_code) values ($1, $2, $3)`,
      [id, input.name, input.country_code.toUpperCase()]
    );
    return { tenant_id: id, name: input.name, country_code: input.country_code.toUpperCase() };
  }

  async getTenant(tenantId: string) {
    const result = await this.db.query<{ id: string; name: string; country_code: string; created_at: string }>(
      `select id, name, country_code, created_at::text from tenants where id = $1`,
      [tenantId]
    );
    if (!result.rowCount) throw new Error('Tenant not found');
    const row = result.rows[0];
    return { tenant_id: row.id, name: row.name, country_code: row.country_code, created_at: row.created_at };
  }
}
