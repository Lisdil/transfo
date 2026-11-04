// Fonction « coach » : relaie les bilans de l'app vers Claude (API Anthropic).
// La clé API reste ici, côté serveur, dans le secret ANTHROPIC_API_KEY. Elle n'est jamais envoyée à l'app.
// Secrets requis : ANTHROPIC_API_KEY, COACH_EMAIL (seul ce compte peut utiliser le coach).

const MODEL = "claude-opus-5-5";
// Opus 5.5 réfléchit toujours avant de répondre : il faut de la marge pour la réflexion ET la réponse.
const MAX_TOKENS = 16000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    // 1. Vérifier l'utilisateur connecté
    const auth = req.headers.get("Authorization") ?? "";
    const apikey = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
    const u = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
    if (!u.ok) return json({ error: "Session expirée : reconnecte-toi à l'app." }, 401);
    const user = await u.json();
    const allowed = (Deno.env.get("COACH_EMAIL") ?? "").trim().toLowerCase();
    if (!allowed) return json({ error: "Secret COACH_EMAIL manquant dans Supabase." }, 500);
    if ((user?.email ?? "").toLowerCase() !== allowed) return json({ error: "Ce compte n'a pas accès au coach." }, 403);

    // 2. Relayer la demande vers Claude
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Secret ANTHROPIC_API_KEY manquant dans Supabase." }, 500);
    const { system, messages } = await req.json();
    if (!Array.isArray(messages) || !messages.length || messages.length > 40) return json({ error: "Demande invalide." }, 400);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: String(system ?? "").slice(0, 20000), messages }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: out?.error?.message ?? `Erreur API ${r.status}` }, 502);
    const text = (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
    if (!text.trim()) return json({ error: `Réponse vide (arrêt : ${out.stop_reason ?? "inconnu"}). Relance l'analyse.` }, 502);
    return json({ text, usage: out.usage, model: out.model, stop: out.stop_reason });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
