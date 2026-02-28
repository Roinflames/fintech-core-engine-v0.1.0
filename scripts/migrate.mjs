#!/usr/bin/env node
/**
 * Migration runner — aplica migraciones SQL en orden.
 * Registra cada migración en la tabla `schema_migrations` para no re-aplicar.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... node scripts/migrate.mjs
 *   npm run migrate
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Tabla de control de migraciones
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    // Leer archivos SQL ordenados
    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rowCount } = await client.query(
        'select 1 from schema_migrations where filename = $1',
        [file]
      );

      if (rowCount) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into schema_migrations (filename) values ($1)',
          [file]
        );
        await client.query('commit');
        console.log(`  apply ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    console.log('Migrations complete.');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
