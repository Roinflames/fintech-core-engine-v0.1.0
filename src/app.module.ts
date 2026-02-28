import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './common/auth/auth.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditService } from './common/audit/audit.service';
import { DatabaseService } from './common/db/database.service';
import { HealthController } from './common/db/health.controller';
import { IdempotencyService } from './common/idempotency/idempotency.service';
import { LedgerService } from './modules/ledger/ledger.service';
import { WalletsController } from './modules/wallets/wallets.controller';
import { WalletsService } from './modules/wallets/wallets.service';
import { TransactionsController } from './modules/transactions/transactions.controller';
import { TransactionsService } from './modules/transactions/transactions.service';
import { ValueController } from './modules/value/value.controller';
import { ValueService } from './modules/value/value.service';
import { ComplianceController } from './modules/compliance/compliance.controller';
import { ComplianceService } from './modules/compliance/compliance.service';
import { IntegrationsController } from './modules/integrations/integrations.controller';
import { IntegrationsService } from './modules/integrations/integrations.service';
import { TenantsController } from './modules/tenants/tenants.controller';
import { TenantsService } from './modules/tenants/tenants.service';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, WalletsController, TransactionsController, ValueController, ComplianceController, IntegrationsController, TenantsController],
  providers: [
    DatabaseService,
    IdempotencyService,
    LedgerService,
    WalletsService,
    TransactionsService,
    ValueService,
    ComplianceService,
    IntegrationsService,
    TenantsService,
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor
    }
  ]
})
export class AppModule {}
