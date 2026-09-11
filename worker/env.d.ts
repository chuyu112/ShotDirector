// Import binding types locally so Worker globals do not replace browser DOM types.
declare module "cloudflare:workers" {
  export const env: {
    // D1 is optional in .openai/hosting.json; getDb checks the binding at runtime.
    DB?: import("@cloudflare/workers-types/2023-07-01").D1Database;
  };
}
