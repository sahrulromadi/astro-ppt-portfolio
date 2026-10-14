import type { APIRoute } from 'astro';

export const prerender = false; // the only route that is not static

// Set in Vercel → Settings → Environment Variables (or by its Supabase integration).
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

export const POST: APIRoute = async ({ request }) => {
  // Dev visits are your own; previews without the env vars have nowhere to write.
  if (import.meta.env.DEV || !SUPABASE_URL || !SUPABASE_SECRET_KEY) return new Response(null, { status: 204 });

  const row = {
    ip_address: request.headers.get('x-real-ip') ?? '', // set by Vercel, cannot be spoofed by the client
    user_agent: (request.headers.get('user-agent') ?? '').slice(0, 512),
  };
  // Supabase REST API; secret keys go on the apikey header (they are not JWTs).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_visits`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) console.error('portfolio_visits insert failed', res.status, await res.text());
  return new Response(null, { status: 204 });
};
