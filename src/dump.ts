import fs from 'fs';
import { Chat } from './chat';
import { Config } from './config';

const config: Config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const chat = new Chat(config);
chat.open();
