import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class BoardService {
  getInbox(): never {
    throw new NotImplementedException();
  }

  getPipeline(): never {
    throw new NotImplementedException();
  }

  moveStage(_conversationId: string, _stage: string): never {
    throw new NotImplementedException();
  }
}
