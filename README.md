# Fintech Core Engine

Infraestructura financiera backend (no app) con ledger de doble entrada, wallets y APIs REST.

## Version
- API v1 (URI versioning — todos los endpoints bajo `/v1/`)
- Package v0.1.3

## Stack
- NestJS (Node.js 20)
- PostgreSQL
- OpenAPI 3
- Docker-first

## Estructura
- `src/modules/ledger`: posting engine y reglas contables.
- `src/modules/wallets`: wallets y consulta de saldo.
- `src/modules/transactions`: transferencias y reversos.
- `src/modules/value`: emision/redencion de valor interno.
- `src/modules/compliance`: politicas de limites y KYC por tenant/moneda.
- `src/modules/integrations`: conectores banco/PSP (cash_in/cash_out). Patron IConnector + MockConnector.
- `db/migrations/001_init.sql`: esquema inicial.
- `docs/openapi.yaml`: contrato REST inicial.

## Ejecutar local
```bash
cp .env.example .env
npm install
npm run start:dev
```

API Explorer (Swagger UI): http://localhost:3000/api

## Quick Start helper

- `scripts/quick-start.sh` prepara el entorno completo: crea `.env` si falta, instala dependencias (`npm install`), aplica `npm run migrate` y corre `npm run build`.  
- Lanza `./scripts/quick-start.sh` para ejecutar todo de corrido; agrega `--serve` si querés que termine con `npm run start:dev` y `--skip-install` cuando ya tenés `node_modules`.
- La salida final recuerda: `npm run start:dev` (o usá `--serve` en el script), `npm run check:concurrency` (requiere `TENANT_ID`, `FROM_WALLET_ID`, `TO_WALLET_A_ID`, `TO_WALLET_B_ID`), y `npm run build && npm test -- --runInBand` para validar regresiones.

## Docker
```bash
docker compose up --build
```

## Endpoints base
Todos bajo `/v1/` excepto health.

- `GET /health` ← sin versión
- `POST /v1/wallets`
- `GET /v1/wallets/:walletId`
- `GET /v1/wallets/:walletId/balance`
- `POST /v1/transfers`
- `GET /v1/transactions/:transactionId`
- `POST /v1/transactions/:transactionId/reverse`
- `POST /v1/value/issue`
- `POST /v1/value/redeem`
- `POST /v1/compliance/policies`
- `GET /v1/compliance/policies/:tenantId/:currency`
- `POST /v1/integrations/cash-in`
- `POST /v1/integrations/cash-out`
- `GET /v1/integrations/transfers/:externalTransferId`

## Notas de diseno
- Ledger append-only.
- Reversos por compensacion.
- Saldos derivados del ledger.
- Idempotencia obligatoria en operaciones criticas.

## Migraciones
- `001_init.sql`: esquema base de core financiero.
- `002_financial_hardening.sql`: hardening contable (append-only + balance por batch + reversal unico por transaccion original).
- `003_compliance.sql`: kyc_verified en wallets + tabla compliance_policies (limites por tenant/moneda).
- `004_integrations.sql`: tabla external_transfers para cash_in/cash_out via conectores banco/PSP.

## Auth y scopes
El backend exige JWT Bearer (`JWT_SECRET` en `.env`), y cada endpoint requiere scopes:
- `wallets:create`, `wallets:read`
- `transactions:write`, `transactions:read`
- `value:issue`, `value:redeem`
- `compliance:read`, `compliance:write`
- `integrations:read`, `integrations:write`

Ejemplo de token payload:
```json
{ "sub": "userX", "scopes": ["wallets:create","transactions:write","value:issue"] }
```

## Prueba de concurrencia (double-spend smoke)
Con la API arriba y wallets de prueba creadas:

```bash
export TENANT_ID=<tenant_uuid>
export FROM_WALLET_ID=<wallet_origen_uuid>
export TO_WALLET_A_ID=<wallet_destino_a_uuid>
export TO_WALLET_B_ID=<wallet_destino_b_uuid>
export TRANSFER_AMOUNT=100.00
export CURRENCY=CLP
npm run check:concurrency
```

Resultado esperado:
- Si el wallet origen no alcanza para ambas transferencias concurrentes, solo una debe postear y la otra debe fallar por fondos insuficientes.
