import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ScopesGuard } from '../../common/auth/scopes.guard';

@Controller('compliance')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('policies/:tenantId/:currency')
  @RequireScopes('compliance:read')
  async getPolicy(
    @Param('tenantId') tenantId: string,
    @Param('currency') currency: string
  ) {
    const policy = await this.compliance.getPolicy(tenantId, currency.toUpperCase());
    if (!policy) throw new NotFoundException('Compliance policy not found');
    return { tenant_id: tenantId, currency: currency.toUpperCase(), ...policy };
  }

  @Post('policies')
  @RequireScopes('compliance:write')
  async upsertPolicy(
    @Body() body: {
      tenant_id: string;
      currency: string;
      max_single_amount?: string | null;
      max_daily_wallet_debit?: string | null;
      max_wallet_balance?: string | null;
      requires_kyc?: boolean;
    }
  ) {
    if (!body.tenant_id || !body.currency) {
      throw new BadRequestException('tenant_id and currency are required');
    }
    const { tenant_id, currency, ...input } = body;
    const policy = await this.compliance.upsertPolicy(tenant_id, currency.toUpperCase(), input);
    return { tenant_id, currency: currency.toUpperCase(), ...policy };
  }
}
