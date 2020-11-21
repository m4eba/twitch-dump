export enum Dump {
  CHAT = 'chat',
  EVENTS = 'events',
  VIDEO = 'video',
  VOD = 'vod',
}

export interface Config {
  dump: Set<Dump>;
  path: string;
  username: string;
  oauth: string;
  oauthVideo: string;
  channel: string;
  clientId: string;
  secret: string;
  statInterval: number;
}
