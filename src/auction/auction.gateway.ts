import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { BidService } from '../bid/bid.service';
import { RedisService } from '../redis/redis.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*' },
  credentials: true,
})
export class AuctionGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AuctionGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => BidService))
    private readonly bidService: BidService,
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    const rawToken =
      client.handshake.auth?.token ||
      client.handshake.headers.authorization ||
      client.handshake.query?.token;

    if (rawToken) {
      const token =
        typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
          ? rawToken.split(' ')[1]
          : (rawToken as string);

      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });
      client.data.userId = payload.sub || payload.id;
    }
  }

  async handleDisconnect(client: Socket) {
    const currentRoom = client.data.auctionId;
    if (currentRoom) {
      this.updateLiveParticipantsCount(currentRoom);
    }
  }

  sendAuctionCreated(auction: any) {
    this.server.emit('auctionCreated', auction);
  }

  sendAuctionUpdated(auction: any) {
    this.server.emit('auctionUpdated', auction);
  }

  sendSubscriptionUpdated(auctionId: string, subscribersCount: number) {
    const roomName = `auction:${auctionId}`;
    this.server.to(roomName).emit('auctionSubscriptionUpdated', {
      auctionId,
      subscribersCount,
    });
    this.server.emit('auctionSubscriptionUpdated', {
      auctionId,
      subscribersCount,
    });
  }

  @SubscribeMessage('joinAuctionRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { auctionId: string },
  ) {
    if (!data?.auctionId) return;

    const authUserId = client.data.userId;
    const newRoomName = `auction:${data.auctionId}`;
    const previousRoom = client.data.auctionId;

    if (previousRoom && previousRoom !== data.auctionId) {
      await client.leave(`auction:${previousRoom}`);
      this.updateLiveParticipantsCount(previousRoom);
    }

    client.data.auctionId = data.auctionId;
    await client.join(newRoomName);
    this.updateLiveParticipantsCount(data.auctionId);

    try {
      const snapshot = await this.bidService.getAuctionSnapshot(
        data.auctionId,
        authUserId,
      );

      client.emit('auctionRoomSnapshot', {
        auction: snapshot.auction,
        bids: snapshot.bids,
        currentPrice: snapshot.currentPrice,
        endAt: snapshot.endAt,
        status: snapshot.status,
        winner: snapshot.winner,
        accessGranted: snapshot.isSubscribed,
        denyReason: snapshot.isSubscribed
          ? null
          : 'Freezing deposit and subscription to auction required',
      });
    } catch (error) {
      this.logger.error(
        ` Error While Serving The Auction Snapshot[${data.auctionId}]:`,
        error,
      );
      client.emit('auctionRoomSnapshotError', {
        message: 'Something Went Wrong',
      });
    }
  }

  @SubscribeMessage('placeBid')
  async handlePlaceBid(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { auctionId: string; amount: number },
  ) {
    const userId = client.data.userId;

    if (!userId) {
      client.emit('bidError', {
        message: 'You Must Signin First',
      });
      return;
    }

    if (
      !data?.auctionId ||
      typeof data?.amount !== 'number' ||
      isNaN(data.amount) ||
      data.amount <= 0
    ) {
      client.emit('bidError', {
        message: 'Invalid Auction Identity',
      });
      return;
    }

    const lastBidTimeKey = `spam-lock:${userId}`;
    const isLockAcquired = await this.redisService.setNx(
      lastBidTimeKey,
      'locked',
      1,
    );

    if (!isLockAcquired) {
      client.emit('bidError', {
        message: 'Wait For 1 Sec',
      });
      return;
    }

    try {
      await this.bidService.placeBid(userId, data.auctionId, data.amount);
    } catch (error) {
      const userFriendlyMessage =
        error instanceof SyntaxError || !error.message
          ? 'Something Went Wrong. Try Again Later'
          : error.message;

      client.emit('bidError', { message: userFriendlyMessage });
    }
  }

  private updateLiveParticipantsCount(auctionId: string) {
    const roomName = `auction:${auctionId}`;
    try {
      const room = this.server.sockets.adapter.rooms.get(roomName);
      const count = room ? room.size : 0;
      this.server.to(roomName).emit('liveParticipantsUpdated', { count });
    } catch (err) {
      this.logger.error(
        `Error While Counting Present[${auctionId}]: ${err.message}`,
      );
    }
  }

  sendAuctionCountsUpdate(counts: { upcoming?: number; completed?: number }) {
    this.server.emit('auctionCountsUpdated', counts);
  }

  sendNewBid(
    auctionId: string,
    payload: {
      bid: any;
      newPrice: number;
      newEndAt: Date;
    },
  ) {
    const roomName = `auction:${auctionId}`;

    const formattedBid = {
      id: payload.bid.id,
      amount: payload.bid.amount,
      createdAt: payload.bid.createdAt,
      bidder: payload.bid.bidder,
    };

    this.server.to(roomName).emit('bidUpdated', {
      bid: formattedBid,
      currentPrice: payload.newPrice,
      lastBidderId: payload.bid.userId,
      createdAt: payload.bid.createdAt,
      newEndAt: payload.newEndAt.toISOString(),
    });

    this.sendAuctionUpdated({
      id: auctionId,
      currentPrice: payload.newPrice,
      endAt: payload.newEndAt.toISOString(),
    });
  }

  sendTotalUsersUpdate(count: number) {
    this.server.emit('totalUsersUpdate', { totalUsers: count });
  }
}
