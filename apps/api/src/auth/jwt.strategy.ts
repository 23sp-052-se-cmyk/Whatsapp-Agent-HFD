import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { OrganizationRole, type AuthenticatedUser } from '@repo/shared';

interface JwtPayload {
  sub: string;
  orgId: string;
  email: string;
  role: OrganizationRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.orgId) {
      throw new UnauthorizedException('Malformed JWT payload');
    }
    return {
      sub: payload.sub,
      orgId: payload.orgId,
      email: payload.email,
      role: payload.role,
    };
  }
}
