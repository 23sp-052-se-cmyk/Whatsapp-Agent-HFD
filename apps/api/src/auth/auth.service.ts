import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { db, members, organizations, eq } from '@repo/db';
import { OrganizationRole } from '@repo/shared';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async register(email: string, password: string, orgName: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, normalizedEmail))
      .limit(1);

    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    return db.transaction(async (tx) => {
      const orgs = await tx
        .insert(organizations)
        .values({ name: orgName })
        .returning();
      const org = orgs[0]!;

      const mems = await tx
        .insert(members)
        .values({
          orgId: org.id,
          email: normalizedEmail,
          passwordHash,
          role: 'owner',
          status: 'active',
        })
        .returning();
      const member = mems[0]!;

      const token = this.jwt.sign({
        sub: member.id,
        orgId: member.orgId,
        email: member.email,
        role: member.role,
      });

      return {
        accessToken: token,
        member: {
          id: member.id,
          orgId: member.orgId,
          email: member.email,
          role: member.role,
        },
      };
    });
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.email, normalizedEmail))
      .limit(1);

    if (!member || !member.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(password, member.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (member.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    const token = this.jwt.sign({
      sub: member.id,
      orgId: member.orgId,
      email: member.email,
      role: member.role,
    });

    return {
      accessToken: token,
      member: {
        id: member.id,
        orgId: member.orgId,
        email: member.email,
        role: member.role as OrganizationRole,
      },
    };
  }

  async getProfile(memberId: string) {
    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!member) {
      throw new UnauthorizedException('Member not found');
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, member.orgId))
      .limit(1);

    return {
      id: member.id,
      orgId: member.orgId,
      email: member.email,
      role: member.role as OrganizationRole,
      status: member.status,
      org: org
        ? { id: org.id, name: org.name, plan: org.plan, status: org.status }
        : null,
    };
  }
}
