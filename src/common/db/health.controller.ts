import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  getHealth() {
    return { ok: true, service: 'fintech-core-engine', version: 'v0.1.3' };
  }
}
