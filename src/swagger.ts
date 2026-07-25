import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mark 254 Commerce API',
      version: '0.1.0',
      description:
        'Products, categories, and orders backend for the Mark 254 Active Wear shop (part of the Marksila254 platform). Auth/blog/testimonials/users live on a separate existing backend — this service only covers commerce.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        AdminKey: { type: 'apiKey', in: 'header', name: 'x-admin-key' },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
});
