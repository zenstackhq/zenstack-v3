import { Module, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PolicyPlugin } from '@zenstackhq/plugin-policy';
import { FastifyRequest } from 'fastify';
import { AppAuthController } from './app-auth.controller';
import { AppAutoController } from './app-auto.controller';
import { AppController } from './app.controller';
import { DbService } from './db.service';
import { isAdmin } from './utils';

@Module({
  imports: [],
  controllers: [AppController, AppAuthController, AppAutoController],
  providers: [
    // inject a standard (no-access-control) DbService
    DbService,

    // inject an access-controlled DbService with name "Auth_DB"
    {
      provide: 'AUTH_DB',
      scope: Scope.REQUEST,
      useFactory: (req: FastifyRequest, db: DbService) => {
        // simulate authentication
        const admin = isAdmin(req);
        return db.$use(new PolicyPlugin()).$setAuth({ id: '1', admin });
      },
      inject: [REQUEST, DbService],
    },
  ],
})
export class AppModule {}
