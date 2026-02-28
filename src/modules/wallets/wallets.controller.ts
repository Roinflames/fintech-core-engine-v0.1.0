import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ScopesGuard } from '../../common/auth/scopes.guard';

@Controller('wallets')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @RequireScopes('wallets:create')
  async createWallet(@Body() body: { tenant_id: string; owner_id: string; currency: string }) {
    if (!body.tenant_id || !body.owner_id || !body.currency) {
      throw new BadRequestException('tenant_id, owner_id and currency are required');
    }
    try {
      return await this.wallets.createWallet(body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get(':walletId')
  @RequireScopes('wallets:read')
  async getWallet(@Param('walletId') walletId: string) {
    try {
      return await this.wallets.getWallet(walletId);
    } catch (error) {
      throw new NotFoundException((error as Error).message);
    }
  }

  @Get(':walletId/balance')
  @RequireScopes('wallets:read')
  async getBalance(@Param('walletId') walletId: string) {
    try {
      return await this.wallets.getBalance(walletId);
    } catch (error) {
      throw new NotFoundException((error as Error).message);
    }
  }
}
