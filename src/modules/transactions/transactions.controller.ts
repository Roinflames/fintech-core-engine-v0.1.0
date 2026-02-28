import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ScopesGuard } from '../../common/auth/scopes.guard';

@Controller()
@UseGuards(JwtAuthGuard, ScopesGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('transfers')
  @RequireScopes('transactions:write')
  async createTransfer(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { tenant_id: string; from_wallet_id: string; to_wallet_id: string; amount: string; currency: string }
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    try {
      return await this.transactions.createTransfer(idempotencyKey, body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get('transactions/:transactionId')
  @RequireScopes('transactions:read')
  async getTransaction(@Param('transactionId') transactionId: string) {
    try {
      return await this.transactions.getTransaction(transactionId);
    } catch (error) {
      throw new NotFoundException((error as Error).message);
    }
  }

  @Post('transactions/:transactionId/reverse')
  @RequireScopes('transactions:write')
  async reverseTransaction(
    @Param('transactionId') transactionId: string,
    @Headers('idempotency-key') idempotencyKey: string
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    try {
      return await this.transactions.reverseTransaction(idempotencyKey, transactionId);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
