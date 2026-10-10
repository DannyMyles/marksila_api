import { app } from './app';
import { env } from './env';

const onListen = () => {
  console.log(`mark254-commerce-api listening on http://${env.host ?? 'localhost'}:${env.port}`);
  console.log(`Swagger docs: http://${env.host ?? 'localhost'}:${env.port}/docs`);
};

if (env.host) app.listen(env.port, env.host, onListen);
else app.listen(env.port, onListen);
