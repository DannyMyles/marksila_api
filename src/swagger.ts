import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Shared Apps API (mark254-commerce-api)',
      version: '0.2.0',
      description:
        'One backend for several apps (Fitness, Source of Adventure, ...). Every /api request must send X-App-Key: <app key>; all data is scoped to that app. Orders and bookings are confirmed on WhatsApp — the create responses include a pre-filled wa.me link.',
    },
    servers: [{ url: '/' }],
    security: [{ AppKey: [] }],
    components: {
      securitySchemes: {
        AppKey: { type: 'apiKey', in: 'header', name: 'x-app-key' },
        AdminKey: { type: 'apiKey', in: 'header', name: 'x-admin-key' },
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
});
