import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ScopesGuard } from '../../common/auth/scopes.guard';

@Controller('integrations')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post('cash-in')
  @RequireScopes('integrations:write')
  async cashIn(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: {
      tenant_id: string;
      wallet_id: string;
      amount: string;
      currency: string;
      provider: string;
      external_reference: string;
    }
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    try {
      return await this.integrations.cashIn(idempotencyKey, body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post('cash-out')
  @RequireScopes('integrations:write')
  async cashOut(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: {
      tenant_id: string;
      wallet_id: string;
      amount: string;
      currency: string;
      provider: string;
      external_reference: string;
    }
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    try {
      return await this.integrations.cashOut(idempotencyKey, body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get('transfers/:externalTransferId')
  @RequireScopes('integrations:read')
  async getTransfer(@Param('externalTransferId') externalTransferId: string) {
    try {
      return await this.integrations.getTransfer(externalTransferId);
    } catch (error) {
      throw new NotFoundException((error as Error).message);
    }
  }
}
