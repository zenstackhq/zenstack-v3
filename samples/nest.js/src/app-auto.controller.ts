import {
  All,
  Controller,
  Inject,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { RestApiHandler } from '@zenstackhq/server/api';
import { DbService } from './db.service';
import { schema } from './zenstack/schema';
import type { FastifyRequest, FastifyReply } from 'fastify';

// This controller uses ZenStack API handler to automatically provide REST API with access control
@Controller('api-auto')
export class AppAutoController {
  private readonly apiHandler = new RestApiHandler({
    schema,
    endpoint: 'http://localhost:3000/api-auto',
  });

  constructor(@Inject('AUTH_DB') private readonly dbService: DbService) {}

  @All('*')
  async handleAll(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @Param() params: Record<string, any>,
    @Query() query: Record<string, any>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pathParam: string = params?.['*'] ?? ('' as string);

    const result = await this.apiHandler.handleRequest({
      method: req.method || '',
      path: pathParam,
      query,
      requestBody: req.body,
      client: this.dbService,
    });

    res.statusCode = result.status;
    res.send(result.body);
  }
}
