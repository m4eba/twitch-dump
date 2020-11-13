export enum Dump {
  CHAT = 'chat',
  EVENTS = 'events',
  VIDEO = 'video',
}

export interface Config {
  dump: Set<Dump>;
  path: string;
  username: string;
  oauth: string;
  channel: string;
  clientId: string;
  secret: string;
  statInterval: number;
}
