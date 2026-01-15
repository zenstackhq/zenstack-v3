import { Controller, Get, Inject, Post } from '@nestjs/common';
import { DbService } from './db.service';

// This controller uses an access-controlled DbService
@Controller('api-auth')
export class AppAuthController {
  constructor(@Inject('AUTH_DB') private readonly dbService: DbService) {}

  @Get('/posts')
  async getPosts() {
    return this.dbService.post.findMany();
  }

  @Post('/posts')
  createPost() {
    console.log('Handling post');
    return this.dbService.post.create({
      data: {
        title: 'Hello World',
        published: true,
        authorId: '1',
      },
    });
  }
}
