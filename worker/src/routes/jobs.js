import { runGenerationPipeline } from "../services/document/generationPipeline.js";
import { createUserError } from "../services/security/inputValidator.js";
import {
  createJobId,
  ensureJob,
  getJobById,
  insertJob,
  isTerminalJobStatus,
  listRecentJobs,
  markJobCancelled,
  markJobCancelling,
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

function elapsedMsSince(iso) {
  const timestamp = new Date(iso || "").getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Date.now() - timestamp;
}

async function reconcileJobState(env, config, job) {
  if (!job || isTerminalJobStatus(job.status)) {
    return job;
  }

  if (job.status === "cancelling") {
    if (elapsedMsSince(job.updatedAt) > config.jobHeartbeatTimeoutMs) {
      await markJobCancelled(env, job.jobId, {
        progressMessage: "중단 요청을 반영해 작업을 종료했습니다.",
        errorStage: job.currentStage || ""
      });
      return getJobById(env, job.jobId);
    }
    return job;
  }

  if (job.status !== "processing") {
    return job;
  }

  const totalElapsed = elapsedMsSince(job.createdAt);
  const heartbeatElapsed = elapsedMsSince(job.updatedAt);
  if (totalElapsed <= config.jobMaxProcessingMs && heartbeatElapsed <= config.jobHeartbeatTimeoutMs) {
    return job;
  }

  const reason =
    heartbeatElapsed > config.jobHeartbeatTimeoutMs
      ? "작업 진행 업데이트가 오래 멈춰 작업을 자동 종료했습니다."
      : "작업 허용 시간을 초과해 자동 종료했습니다.";

  await markJobFailed(env, job.jobId, new Error(reason), {
    errorStage: job.currentStage || "queued",
    progressMessage: reason,
    sourceMode: job.sourceMode || "legacy",
    sourceOptimization: job.sourceOptimization || {}
  });

  return getJobById(env, job.jobId);
}

function assertJobOwner(job, sessionId) {
  if (!sessionId) {
    throw createUserError("브라우저 세션 정보가 없어 작업을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.", 400, "MISSING_SESSION_ID");
  }
  if (job.sessionId !== sessionId) {
    throw createUserError("이 작업에 접근할 권한이 없습니다.", 403, "JOB_FORBIDDEN");
  }
}

function createJobControl(env, jobId, config, getStageContext) {
  const stageContext = typeof getStageContext === "function" ? getStageContext : () => ({});

  return {
    async assertActive(stageHint = "", progressMessage = "") {
      const job = await getJobById(env, jobId);
      if (!job) {
        throw createUserError("작업 정보를 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
      }

      const reconciled = await reconcileJobState(env, config, job);
      if (reconciled.status === "cancelling") {
        const context = stageContext();
        await markJobCancelled(env, jobId, {
          progressMessage: "사용자 요청으로 작업을 중단했습니다.",
          errorStage: stageHint || context.lastStage || reconciled.currentStage || ""
        });
        const error = createUserError("사용자 요청으로 작업을 중단했습니다.", 409, "JOB_CANCELLED");
        error.skipFailureUpdate = true;
        throw error;
      }

      if (reconciled.status === "failed") {
        const error = createUserError(reconciled.errorMessage || reconciled.progressMessage || "작업이 자동 종료되었습니다.", 409, "JOB_STALE_TIMEOUT");
        error.skipFailureUpdate = true;
        throw error;
      }

      if (reconciled.status === "cancelled") {
        const error = createUserError(reconciled.progressMessage || "작업이 중단되었습니다.", 409, "JOB_CANCELLED");
        error.skipFailureUpdate = true;
        throw error;
      }

      if (progressMessage) {
        const context = stageContext();
        await updateJobProgress(
          env,
          jobId,
          reconciled.status === "cancelling" ? "cancelling" : "processing",
          normalizeJobStage(stageHint || context.lastStage || reconciled.currentStage || "queued"),
          progressMessage,
          {
            sourceMode: context.sourceMode || "legacy",
            sourceOptimization: context.sourceOptimization || {}
          }
        );
      }
    }
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

export async function handleListRecentJobs(request, env, config) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return json({ ok: true, jobs: [] });
  }

  const jobs = await listRecentJobs(env, sessionId);
  const reconciledJobs = [];
  for (const job of jobs) {
    reconciledJobs.push(await reconcileJobState(env, config, job));
  }

  return json({
    ok: true,
    jobs: reconciledJobs.map(summarizeJob)
  });
}

export async function handleGetJob(request, jobId, env, config) {
  const sessionId = getSessionId(request);
  const job = await ensureJob(env, jobId);
  assertJobOwner(job, sessionId);
  const reconciled = await reconcileJobState(env, config, job);
  return json({
    ok: true,
    job: summarizeJob(reconciled)
  });
}

export async function handleCancelJob(request, jobId, env, config) {
  const sessionId = getSessionId(request);
  const job = await ensureJob(env, jobId);
  assertJobOwner(job, sessionId);
  const reconciled = await reconcileJobState(env, config, job);

  if (isTerminalJobStatus(reconciled.status)) {
    return json({
      ok: true,
      job: summarizeJob(reconciled),
      message: "이미 종료된 작업입니다."
    });
  }

  await markJobCancelling(env, jobId, {
    progressMessage: "중단 요청을 받았습니다. 가능한 가장 빠른 지점에서 멈춥니다."
  });

  return json({
    ok: true,
    job: summarizeJob(await getJobById(env, jobId)),
    message: "중단 요청을 등록했습니다."
  });
}

export async function handleGetJobResult(request, jobId, env, config) {
  const sessionId = getSessionId(request);
  const job = await ensureJob(env, jobId);
  assertJobOwner(job, sessionId);
  const reconciled = await reconcileJobState(env, config, job);
  if (reconciled.status !== "completed" || !reconciled.resultKey) {
    throw createUserError("아직 완료된 결과가 없습니다.", 409, "JOB_NOT_COMPLETED");
  }

  const result = await readJobResult(env, reconciled.resultKey);
  if (!result) {
    throw createUserError("저장된 결과를 찾을 수 없습니다.", 404, "JOB_RESULT_NOT_FOUND");
  }

  return json({
    ok: true,
    job: summarizeJob(reconciled),
    result
  });
}

export async function handleGetJobLog(request, jobId, env, config) {
  const sessionId = getSessionId(request);
  const job = await ensureJob(env, jobId);
  assertJobOwner(job, sessionId);
  const reconciled = await reconcileJobState(env, config, job);
  return json({
    ok: true,
    log: {
      jobId: reconciled.jobId,
      status: reconciled.status,
      errorStage: reconciled.errorStage || "",
      errorMessage: reconciled.errorMessage || "",
      updatedAt: reconciled.updatedAt
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
  const jobControl = createJobControl(env, jobId, config, () => ({
    lastStage,
    sourceMode,
    sourceOptimization
  }));

  try {
    await jobControl.assertActive("queued");
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
      await jobControl.assertActive(detail.stage || lastStage, message);
      await updateJobProgress(env, jobId, "processing", lastStage, message, {
        sourceMode,
        sourceOptimization
      });
    }, jobControl);

    sourceMode =
      result?.data?.meta?.optimization?.factPreservingSummaryApplied || result?.data?.meta?.optimization?.stageInputSlicingApplied
        ? "optimized"
        : "legacy";
    sourceOptimization = result?.data?.meta?.optimization || {};

    await jobControl.assertActive("ai", "결과를 저장하고 있습니다.");
    const resultKey = await saveJobResult(env, jobId, result);
    await markJobCompleted(env, jobId, resultKey, {
      progressMessage: "문서 생성이 완료되었습니다. 결과를 다시 열어볼 수 있습니다.",
      expiresAt: buildExpiryIso(),
      sourceMode,
      sourceOptimization
    });
  } catch (error) {
    if (!error?.skipFailureUpdate) {
      await markJobFailed(env, jobId, error, {
        errorStage: lastStage,
        sourceMode,
        sourceOptimization
      });
    }
  } finally {
    await deleteJobInput(env, job.inputKey);
  }
}
