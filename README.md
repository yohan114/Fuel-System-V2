This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment variables

Set these in `.env` (not committed):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite database path |
| `AUTH_SECRET` | JWT signing secret. **Required in production** — the app refuses to sign/verify sessions without it (dev falls back to an insecure default with a warning). Use a long random value, e.g. `openssl rand -hex 32` |
| `CRON_SECRET` | Auth for `/api/cron/billing` |
| `SMTP_HOST` | SMTP server host (email invoices) |
| `SMTP_PORT` | SMTP port (587 STARTTLS, 465 implicit TLS) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address, e.g. `"E&C Billing <billing@example.com>"` |

Email invoices require all five `SMTP_*` vars. Without them, the **Email Invoice** button reports that email is not configured (it never throws). Each site's recipient comes from the project's **Billing Contact Email** (set on `/admin/projects`).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
