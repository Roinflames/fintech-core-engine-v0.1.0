import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SCOPES_KEY } from './scopes.decorator';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredScopes = this.reflector.get<string[]>(SCOPES_KEY, context.getHandler()) ?? [];
    if (!requiredScopes.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { scopes?: string[] } | undefined;
    const granted = user?.scopes ?? [];
    return requiredScopes.every((scope) => granted.includes(scope));
  }
}
