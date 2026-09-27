# Stress Congress

Expo iOS/Android app with a Node.js API and PostgreSQL database.

## Railway deployment

1. Create a Railway project with a Node service and PostgreSQL service.
2. Connect the repository and use the included `railway.json`.
3. Add the variables from `.env.example` in Railway. Never commit `.env` or real credentials.
4. Set `EXPO_PUBLIC_API_URL` to the public HTTPS URL of the Railway API before building the mobile app.
5. Deploy. Railway builds the Expo static bundle and server, then runs `npm run server:prod`.

## Local development

```bash
npm ci
npm run preview:dev
```

The app expects PostgreSQL and the variables in `.env.example`.

## Mobile builds

Configure the Railway API URL in the EAS environment, then build with the appropriate EAS profile from `eas.json`.
