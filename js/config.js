/* Configuração por ambiente.
 * A chave abaixo é a chave PUBLICÁVEL do Supabase (segura no navegador: quem protege os dados é a RLS).
 * Para separar produção de desenvolvimento, crie um 2º projeto Supabase, aplique as migrations de
 * supabase/migrations e preencha ENVS.development. Enquanto estiver vazio, hosts que não são de produção
 * (localhost, previews da Vercel) usam o banco de produção e mostram um aviso vermelho no topo.
 */
window.APP_CONFIG = {
  VERSION: "35",
  REQUIRED_SCHEMA: 1,
  ENVS: {
    production: {
      hosts: ["creche-arya.vercel.app"],
      url: "https://svtlpvsfdmfdrgzhpbvz.supabase.co",
      key: "sb_publishable_u1RNww4af2uybpEGbEicmw_Nh2cR_3R"
    },
    development: { url: "", key: "" }
  }
};
