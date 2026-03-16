import { runGenerationPipeline } from "../services/document/generationPipeline.js";
import { sseHeaders, json } from "../utils/response.js";

export async function handleGenerateJson(requestPayload, env, config) {
  const state = { request: requestPayload, bggForumData: null, pdfExtraction: null };
  return json(await runGenerationPipeline(state, env, config));
}

export function handleGenerateStream(requestPayload, env, config, origin) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const state = { request: requestPayload, bggForumData: null, pdfExtraction: null };
      const write = (event, data) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        write("progress", { message: "요청을 확인하고 있습니다...", stage: "start" });
        const result = await runGenerationPipeline(state, env, config, async (message, detail) => {
          write("progress", { message, ...detail });
        });
        write("result", result);
        write("done", { ok: true });
      } catch (error) {
        write("error", {
          ok: false,
          message: error.message || "처리 중 오류가 발생했습니다.",
          code: error.code || "UNKNOWN"
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: sseHeaders(origin, config.allowedOrigin)
  });
}
