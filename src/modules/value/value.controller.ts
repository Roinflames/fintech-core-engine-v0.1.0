import { BadRequestException, Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ValueService } from './value.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ScopesGuard } from '../../common/auth/scopes.guard';

@Controller('value')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class ValueController {
  constructor(private readonly value: ValueService) {}

  @Post('issue')
  @RequireScopes('value:issue')
  async issueValue(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { tenant_id: string; wallet_id: string; amount: string; currency: string }
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    try {
      return await this.value.issue(idempotencyKey, body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post('redeem')
  @RequireScopes('value:redeem')
  async redeemValue(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { tenant_id: string; wallet_id: string; amount: string; currency: string }
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    try {
      return await this.value.redeem(idempotencyKey, body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
