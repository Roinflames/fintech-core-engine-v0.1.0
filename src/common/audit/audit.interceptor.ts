import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler().name;
    const actorId = request.user?.userId ?? null;
    const entityId = request.params?.walletId ?? request.params?.transactionId ?? null;
    const action = `${request.method} ${request.route?.path ?? request.url}`;

    return next.handle().pipe(
      tap(() => {
        this.audit.log(actorId, action, request.route?.path ?? 'unknown', entityId, {
          tenant_id: request.body?.tenant_id ?? request.query?.tenant_id ?? null,
          request: request.body
        });
      })
    );
  }
}
