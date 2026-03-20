import { runGenerationPipeline } from "../services/document/generationPipeline.js";
import { createUserError } from "../services/security/inputValidator.js";
import {
  createJobId,
  ensureJob,
  getJobById,
  insertJob,
  listRecentJobs,
  markJobCompleted,
  markJobFailed,
  normalizeJobStage,
  updateJobProgress
} from "../services/jobs/repository.js";
import { buildExpiryIso, deleteJobInput, readJobInput, readJobResult, saveJobInput, saveJobResult } from "../services/jobs/storage.js";
import { json } from "../utils/response.js";

function getSessionId(request) {
  return String(request.headers.get("x-playready-session-id") || "").trim();
}

function buildSourceFiles(payload) {
  return {
    rulebookFileName: String(payload?.pdfFileName || "").trim(),
    faqFileName: String(payload?.faqPdfFileName || "").trim(),
    extraFileNames: (payload?.additionalMaterials || []).map((item) => item.fileName).filter(Boolean)
  };
}

function summarizeJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    currentStage: job.currentStage,
    progressMessage: job.progressMessage,
    gameName: job.gameName,
    bggId: job.bggId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    sourceFiles: {
      rulebookFileName: job.rulebookFileName,
      faqFileName: job.faqFileName,
      extraFileNames: job.extraFileNames || []
    },
    sourceMode: job.sourceMode || "legacy",
    sourceOptimization: job.sourceOptimization || {}
  };
}

export async function handleCreateJob(request, payload, env, config) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    throw createUserError("브라우저 세션 정보가 없어 작업을 접수할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.", 400, "MISSING_SESSION_ID");
  }

  const jobId = createJobId();
  const inputKey = await saveJobInput(env, jobId, payload);
  const sourceFiles = buildSourceFiles(payload);

  const job = await insertJob(env, {
    jobId,
    sessionId,
    status: "queued",
    currentStage: "queued",
    progressMessage: "작업을 접수했습니다. 서버에서 순서를 기다리고 있습니다.",
    gameName: payload.gameName || sourceFiles.rulebookFileName || sourceFiles.faqFileName || "보드게임",
    bggId: payload.bggId || "",
    rulebookFileName: sourceFiles.rulebookFileName,
    faqFileName: sourceFiles.faqFileName,
    extraFileNames: sourceFiles.extraFileNames,
    inputKey,
    sourceMode: "queued"
  });

  await env.PLAYREADY_JOBS.send({ jobId });

  return json({
    ok: true,
    job: summarizeJob(job)
  });
}

export async function handleListRecentJobs(request, env) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return json({ ok: true, jobs: [] });
  }

  const jobs = await listRecentJobs(env, sessionId);
  return json({
    ok: true,
    jobs: jobs.map(summarizeJob)
  });
}

export async function handleGetJob(jobId, env) {
  const job = await ensureJob(env, jobId);
  return json({
    ok: true,
    job: summarizeJob(job)
  });
}

export async function handleGetJobResult(jobId, env) {
  const job = await ensureJob(env, jobId);
  if (job.status !== "completed" || !job.resultKey) {
    throw createUserError("아직 완료된 결과가 없습니다.", 409, "JOB_NOT_COMPLETED");
  }

  const result = await readJobResult(env, job.resultKey);
  if (!result) {
    throw createUserError("저장된 결과를 찾을 수 없습니다.", 404, "JOB_RESULT_NOT_FOUND");
  }

  return json({
    ok: true,
    job: summarizeJob(job),
    result
  });
}

export async function handleGetJobLog(jobId, env) {
  const job = await ensureJob(env, jobId);
  return json({
    ok: true,
    log: {
      jobId: job.jobId,
      status: job.status,
      errorStage: job.errorStage || "",
      errorMessage: job.errorMessage || "",
      updatedAt: job.updatedAt
    }
  });
}

export async function processQueuedJob(jobId, env, config) {
  const job = await getJobById(env, jobId);
  if (!job || !job.inputKey) {
    return;
  }

  const payload = await readJobInput(env, job.inputKey);
  if (!payload) {
    await markJobFailed(env, jobId, new Error("작업 입력 자료를 찾지 못했습니다."), {
      errorStage: "queued",
      sourceMode: "legacy"
    });
    return;
  }

  let lastStage = "queued";
  let sourceMode = "legacy";
  let sourceOptimization = {};

  try {
    await updateJobProgress(
      env,
      jobId,
      "processing",
      "queued",
      "작업을 시작했습니다. 서버에서 자료를 불러오고 있습니다.",
      { sourceMode: "legacy", sourceOptimization: {} }
    );

    const state = { request: payload, bggForumData: null, pdfExtraction: null };
    const result = await runGenerationPipeline(state, env, config, async (message, detail = {}) => {
      lastStage = normalizeJobStage(detail.stage || lastStage);
      await updateJobProgress(env, jobId, "processing", lastStage, message, {
        sourceMode,
        sourceOptimization
      });
    });

    sourceMode =
      result?.data?.meta?.optimization?.factPreservingSummaryApplied || result?.data?.meta?.optimization?.stageInputSlicingApplied
        ? "optimized"
        : "legacy";
    sourceOptimization = result?.data?.meta?.optimization || {};

    const resultKey = await saveJobResult(env, jobId, result);
    await markJobCompleted(env, jobId, resultKey, {
      progressMessage: "문서 생성이 완료되었습니다. 결과를 다시 열어볼 수 있습니다.",
      expiresAt: buildExpiryIso(),
      sourceMode,
      sourceOptimization
    });
  } catch (error) {
    await markJobFailed(env, jobId, error, {
      errorStage: lastStage,
      sourceMode,
      sourceOptimization
    });
  } finally {
    await deleteJobInput(env, job.inputKey);
  }
}
