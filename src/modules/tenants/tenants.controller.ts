import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ScopesGuard } from '../../common/auth/scopes.guard';

@Controller('tenants')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @RequireScopes('tenants:admin')
  async createTenant(@Body() body: { name: string; country_code: string }) {
    if (!body.name || !body.country_code) {
      throw new BadRequestException('name and country_code are required');
    }
    return this.tenants.createTenant(body);
  }

  @Get(':tenantId')
  @RequireScopes('tenants:admin')
  async getTenant(@Param('tenantId') tenantId: string) {
    try {
      return await this.tenants.getTenant(tenantId);
    } catch (error) {
      throw new NotFoundException((error as Error).message);
    }
  }
}
