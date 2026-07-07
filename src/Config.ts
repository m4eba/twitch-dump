export enum Dump {
  CHAT = 'chat',
  EVENTS = 'events',
  VIDEO = 'video',
  VOD = 'vod',
}

export interface Postgres {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
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
  filenamePaddingSize: number;
  refreshDownloadsCountThreshold: number;
  supportedCodecs: string;
  postgres: Postgres | null;
}

export const defaultConfig: Partial<Config> = {
  filenamePaddingSize: 5,
  refreshDownloadsCountThreshold: 3,
  supportedCodecs: 'av1,h265,h264',
};
