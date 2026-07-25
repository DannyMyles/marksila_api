import { app } from './app';
import { env } from './env';

app.listen(env.port, () => {
  console.log(`mark254-commerce-api listening on http://localhost:${env.port}`);
  console.log(`Swagger docs: http://localhost:${env.port}/docs`);
});
