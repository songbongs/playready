import { json } from "../utils/response.js";

export function handleHealth() {
  return json({
    ok: true,
    service: "playready-worker",
    message: "Cloudflare Worker is running."
  });
}
