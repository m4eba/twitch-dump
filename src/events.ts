import TwitchClient, { HelixUser, AccessToken, Channel } from 'twitch';
import WebSocket from 'ws';

import { Config } from './config';
import { WebSocketLogger } from './WebSocketLogger';

export class Events extends WebSocketLogger {
  private client: TwitchClient;
  private user: HelixUser | null = null;
  private channel: Channel | null = null;
  private token: AccessToken | null = null;

  constructor(config: Config) {
    super('wss://pubsub-edge.twitch.tv/v1', 'events', config);
    this.client = TwitchClient.withClientCredentials(
      this.config.clientId,
      this.config.secret
    );
  }

  protected onOpen(): void {
    this.client.helix.users
      .getUserByName(this.config.channel)
      .then((user) => {
        this.user = user;
        return this.client.kraken.channels.getChannel(user!);
      })
      .then((channel) => {
        this.channel = channel;
        return this.client.getAccessToken();
      })
      .then((token) => {
        this.token = token;
        this.topics();
      });
  }

  public topics() {
    if (this.user === null) throw new Error('user not defined');
    if (this.channel === null) throw new Error('channel not defined');
    if (this.ws === null) throw new Error('websocket not defined');

    this.listen(`video-playback-by-id.${this.channel.id}`);
    this.listen(`hype-train-events-v1.${this.channel.id}`);
    this.listen(`leaderboard-events-v1.sub-gifts-sent-${this.channel.id}`);
    this.listen(
      `leaderboard-events-v1.bits-usage-by-channel-v1-${this.channel.id}-WEEK`
    );
    this.listen(`stream-chat-room-v1.${this.channel.id}`);
    this.listen(`broadcast-settings-update.${this.channel.id}`);
    this.listen(`community-points-channel-v1.${this.channel.id}`);
    this.listen(`extension-control.${this.channel.id}`);
    this.listen(`stream-change-by-channel.${this.channel.id}`);
    this.listen(`channel-squad-updates.${this.channel.id}`);
    this.listen(`celebration-events-v1.${this.channel.id}`);
    this.listen(`channel-bounty-board-events.cta.${this.channel.id}`);
    this.listen(`raid.${this.channel.id}`);
    this.listen(`channel-cheer-events-public-v1.${this.channel.id}`);
    this.listen(`polls.${this.channel.id}`);
    this.listen(`channel-sub-gifts-v1.${this.channel.id}`);
    this.listen(`channel-drop-events.${this.channel.id}`);
    this.listen(`pv-watch-party-events.${this.channel.id}`);
    this.listen(
      `leaderboard-events-v1.sub-gifts-sent-118793867-WEEK${this.channel.id}`
    );
  }

  private listen(topic: string) {
    if (!this.ws) return;
    if (!this.token) return;
    this.ws.send(
      JSON.stringify({
        type: 'LISTEN',
        nonce: `NONCE${topic}`,
        data: {
          auth_token: this.token.accessToken,
          topics: [topic],
        },
      })
    );
  }

  protected ping(): void {
    if (!this.ws) return;
    console.log('ping');
    this.ws.send('{"type":"PING"}');
  }
  protected isPong(data: WebSocket.Data): boolean {
    console.log(
      'is pong ',
      data.toString().trim() === '{ "type": "PONG" }',
      data.toString()
    );
    return data.toString().trim() === '{ "type": "PONG" }';
  }
}