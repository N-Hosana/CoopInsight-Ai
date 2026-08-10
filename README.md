# CoopInsightAI Backend

This backend is a simple Node.js + Express + TypeScript API for the CoopInsightAI application.

## Setup

1. Install dependencies:
   ```bash
   cd "CoopInsightAI Backend"
   pnpm install
   ```

2. Start development server:
   ```bash
   pnpm dev
   ```

3. The API runs on `http://localhost:4000` by default.

## Available endpoints

- `GET /api/cooperatives`
- `GET /api/cooperatives/:id`
- `POST /api/cooperatives`
- `GET /api/members`
- `GET /api/transactions`
- `GET /api/activities`
