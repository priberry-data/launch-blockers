import Stripe from "stripe";
export default async (req) => { const e = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature"), Deno.env.get("STRIPE_WEBHOOK_SECRET")); return new Response("ok"); };
