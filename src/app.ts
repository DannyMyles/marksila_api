import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env } from './env';
import { swaggerSpec } from './swagger';
import { categoriesRouter } from './routes/categories';
import { productsRouter } from './routes/products';
import { ordersRouter } from './routes/orders';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { blogsRouter } from './routes/blogs';
import { testimonialsRouter } from './routes/testimonials';
import { trainingsRouter } from './routes/trainings';
import { contactRouter } from './routes/contact';
import { eventsRouter } from './routes/events';
import { galleryRouter } from './routes/gallery';
import { newsletterRouter } from './routes/newsletter';
import { mpesaRouter } from './routes/mpesa';
import { uploadsRoot } from './uploads';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/uploads', express.static(uploadsRoot));

app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/blogs', blogsRouter);
app.use('/api/v1/testimonials', testimonialsRouter);
app.use('/api/v1/trainings', trainingsRouter);
app.use('/api/v1/contact', contactRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/gallery', galleryRouter);
app.use('/api/v1/newsletter', newsletterRouter);
app.use('/api/v1/mpesa', mpesaRouter);

app.use(notFoundHandler);
app.use(errorHandler);
