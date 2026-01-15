import { Controller, Get, Post } from '@nestjs/common';
import { DbService } from './db.service';

// This controller is not access-controlled
@Controller('api')
export class AppController {
  constructor(private readonly dbService: DbService) {}

  @Get('/posts')
  getPosts() {
    return this.dbService.post.findMany();
  }

  @Post('/posts')
  createPost() {
    return this.dbService.post.create({
      data: {
        title: 'Hello World',
        published: true,
        authorId: '1',
      },
    });
  }

  @Post('/drafts')
  createDraft() {
    return this.dbService.post.create({
      data: {
        title: 'Draft Post',
        published: false,
        authorId: '1',
      },
    });
  }
}
