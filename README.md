# Fintech Core Engine

Backend de infraestructura financiera con ledger de doble entrada, wallets multi-tenant y APIs REST. Diseñado como componente de plataforma (no app de usuario final): proporciona las primitivas contables y operacionales sobre las que se construyen productos fintech.

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 |
| Framework | NestJS 10 |
| Base de datos | PostgreSQL |
| Contrato API | OpenAPI 3 (YAML manual) |
| Auth | JWT Bearer + scopes |
| Tests | Jest (unit, in-band) |
| Deploy | Docker / Docker Compose |

## Versiones

- **API:** v1 — todos los endpoints bajo `/v1/` (URI versioning)
- **Package:** 0.1.3

---

## Inicio rápido

### Opción A — Script automático

```bash
./scripts/quick-start.sh          # prepara .env, instala deps, migra y build
./scripts/quick-start.sh --serve  # igual + levanta el servidor al final
```

### Opción B — Manual

```bash
cp .env.example .env      # ajustar variables si es necesario
npm install
npm run migrate           # aplica migraciones SQL en orden
npm run start:dev         # servidor en http://localhost:3000
```

### Opción C — Docker

```bash
docker compose up --build
```

**API Explorer (Swagger UI):** `http://localhost:3000/api`

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/fintech_core` | Conexión a PostgreSQL |
| `JWT_SECRET` | `dev-secret` | Clave de firma JWT |
| `JWT_ISSUER` | `fintech-core` | Claim `iss` esperado en el token |
| `JWT_AUDIENCE` | `fintech-apps` | Claim `aud` esperado en el token |

---

## Arquitectura

### Principios contables
- **Ledger append-only:** los asientos contables nunca se modifican ni eliminan (enforced por trigger en DB).
- **Partida doble:** cada operación genera un batch balanceado de asientos (débito = crédito).
- **Saldos derivados:** el balance de un wallet se calcula siempre desde el ledger, nunca se almacena como campo mutable.
- **Reversos por compensación:** los reversos crean nuevos asientos que invierten el original; máximo un reverso por transacción (índice único en DB).

### Idempotencia
Las operaciones que mutan estado (`transfers`, `value/issue`, `value/redeem`, `integrations`) exigen el header `Idempotency-Key` (UUID). Reintentos con la misma clave devuelven el resultado original sin efectos secundarios.

### Multi-tenant
Todos los recursos (wallets, transacciones, cuentas contables, políticas) están aislados por `tenant_id`. Las cuentas treasury del ledger son internas por tenant y moneda.

---

## Módulos

```
src/
├── common/
│   ├── auth/          # JWT strategy, guards, scopes decorator
│   ├── audit/         # Interceptor de auditoría (log de operaciones)
│   ├── db/            # DatabaseService (pool pg) + HealthController
│   └── idempotency/   # IdempotencyService — dedup por tenant+key
└── modules/
    ├── tenants/        # Registro y consulta de tenants
    ├── ledger/         # PostingEngine: validación y escritura de batches
    ├── wallets/        # Creación de wallets y consulta de balance
    ├── transactions/   # Transferencias entre wallets y reversales
    ├── value/          # Emisión y redención de valor interno (treasury)
    ├── compliance/     # Políticas de límites y KYC por tenant/moneda
    └── integrations/   # Conectores banco/PSP: cash_in y cash_out
```

---

## Endpoints

Todos bajo `/v1/` excepto `/health`.

### Tenants
| Método | Path | Scope | Descripción |
|---|---|---|---|
| `POST` | `/v1/tenants` | `tenants:admin` | Crear tenant |
| `GET` | `/v1/tenants/:tenantId` | `tenants:admin` | Obtener tenant |

### Wallets
| Método | Path | Scope | Descripción |
|---|---|---|---|
| `POST` | `/v1/wallets` | `wallets:create` | Crear wallet |
| `GET` | `/v1/wallets/:walletId` | `wallets:read` | Obtener wallet |
| `GET` | `/v1/wallets/:walletId/balance` | `wallets:read` | Balance del wallet |

### Transacciones
| Método | Path | Scope | Descripción |
|---|---|---|---|
| `POST` | `/v1/transfers` | `transactions:write` | Transferencia entre wallets |
| `GET` | `/v1/transactions/:transactionId` | `transactions:read` | Obtener transacción |
| `POST` | `/v1/transactions/:transactionId/reverse` | `transactions:write` | Reversar transacción |

### Valor interno
| Método | Path | Scope | Descripción |
|---|---|---|---|
| `POST` | `/v1/value/issue` | `value:issue` | Emitir valor desde treasury |
| `POST` | `/v1/value/redeem` | `value:redeem` | Redimir valor hacia treasury |

### Compliance
| Método | Path | Scope | Descripción |
|---|---|---|---|
| `POST` | `/v1/compliance/policies` | `compliance:write` | Crear/actualizar política |
| `GET` | `/v1/compliance/policies/:tenantId/:currency` | `compliance:read` | Obtener política |

### Integrations (banco/PSP)
| Método | Path | Scope | Descripción |
|---|---|---|---|
| `POST` | `/v1/integrations/cash-in` | `integrations:write` | Ingreso de fondos externos |
| `POST` | `/v1/integrations/cash-out` | `integrations:write` | Egreso de fondos al exterior |
| `GET` | `/v1/integrations/transfers/:externalTransferId` | `integrations:read` | Obtener transferencia externa |

### Health
| Método | Path | Auth | Descripción |
|---|---|---|---|
| `GET` | `/health` | No requerida | Estado del servicio y DB |

---

## Auth

El backend exige `Authorization: Bearer <jwt>` en todos los endpoints (excepto `/health`). El payload del token debe incluir un array `scopes`:

```json
{
  "sub": "user-id",
  "iss": "fintech-core",
  "aud": "fintech-apps",
  "scopes": ["wallets:create", "transactions:write", "value:issue"]
}
```

**Scopes disponibles:** `tenants:admin` · `wallets:create` · `wallets:read` · `transactions:write` · `transactions:read` · `value:issue` · `value:redeem` · `compliance:read` · `compliance:write` · `integrations:read` · `integrations:write`

---

## Migraciones

```bash
npm run migrate   # aplica todas las migraciones pendientes en orden
```

| Archivo | Versión | Contenido |
|---|---|---|
| `001_init.sql` | v0.1.0 | Esquema base: tenants, wallets, accounts, transactions, ledger |
| `002_financial_hardening.sql` | v0.1.2 | Ledger append-only (trigger), reversal único por transacción |
| `003_compliance.sql` | v0.1.3 | `kyc_verified` en wallets, tabla `compliance_policies` |
| `004_integrations.sql` | v0.1.4 | Tabla `external_transfers` para cash_in/cash_out |

---

## Tests

```bash
npm test -- --runInBand   # suite completa (46 tests)
npm run test:cov          # con cobertura
```

Cobertura unitaria en todos los servicios: `ledger`, `wallets`, `transactions`, `compliance`, `integrations` (incluye `MockConnector`) y `tenants`.

---

## Prueba de concurrencia (double-spend smoke)

Verifica que el lock pesimista del ledger impide double-spend bajo carga concurrente.

```bash
# Con la API y la DB corriendo:
export TENANT_ID=<uuid>
export FROM_WALLET_ID=<uuid>
export TO_WALLET_A_ID=<uuid>
export TO_WALLET_B_ID=<uuid>
export TRANSFER_AMOUNT=100.00
export CURRENCY=CLP

npm run check:concurrency
```

**Resultado esperado:** si el wallet origen no tiene fondos para ambas transferencias concurrentes, exactamente una debe postear y la otra debe fallar con `Insufficient funds`.

---

## Conectores de integración

El patrón `IConnector` permite registrar conectores reales sin modificar el core:

```typescript
export interface IConnector {
  provider: string;
  validateCashIn(input: ExternalTransferInput): Promise<void>;
  validateCashOut(input: ExternalTransferInput): Promise<void>;
}

// Registrar un conector personalizado:
integrationsService.register(myBankConnector);
```

`MockConnector` (provider: `mock`) está disponible para desarrollo y tests.
