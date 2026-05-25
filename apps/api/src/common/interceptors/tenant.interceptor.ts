import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenantContext } from '@repo/db';
import type { AuthenticatedUser } from '@repo/shared';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.orgId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      runWithTenantContext(user.orgId, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
