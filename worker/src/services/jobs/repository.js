import { createUserError } from "../security/inputValidator.js";

function nowIso() {
  return new Date().toISOString();
}

function randomId(length = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

export function createJobId() {
  return `job_${Date.now()}_${randomId(8)}`;
}

export function normalizeJobStage(stage) {
  if (
    [
      "pdf",
      "pdf-upload",
      "pdf-extract",
      "pdf-faq-upload",
      "pdf-faq-extract",
      "pdf-merge",
      "pdf-warning"
    ].includes(stage)
  ) {
    return "pdf";
  }
  if (["ai", "ai-retry"].includes(stage)) {
    return "ai";
  }
  if (String(stage || "").startsWith("bgg") || stage === "start") {
    return "bgg";
  }
  if (stage === "completed") {
    return "completed";
  }
  if (["failed", "cancelled"].includes(stage)) {
    return "failed";
  }
  return "queued";
}

export function isTerminalJobStatus(status) {
  return ["completed", "failed", "cancelled"].includes(String(status || ""));
}

function mapRow(row) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    sessionId: row.session_id,
    status: row.status,
    currentStage: row.current_stage,
    progressMessage: row.progress_message || "",
    gameName: row.game_name || "",
    bggId: row.bgg_id || "",
    rulebookFileName: row.rulebook_file_name || "",
    faqFileName: row.faq_file_name || "",
    extraFileNames: JSON.parse(row.extra_file_names || "[]"),
    inputKey: row.input_key || "",
    resultKey: row.result_key || "",
    errorMessage: row.error_message || "",
    errorStage: row.error_stage || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || "",
    expiresAt: row.expires_at || "",
    sourceMode: row.source_mode || "",
    sourceOptimization: JSON.parse(row.source_optimization || "{}")
  };
}

export async function insertJob(env, job) {
  const timestamp = nowIso();
  await env.JOBS_DB.prepare(
    `INSERT INTO jobs (
      job_id, session_id, status, current_stage, progress_message,
      game_name, bgg_id, rulebook_file_name, faq_file_name, extra_file_names,
      input_key, result_key, error_message, error_stage,
      created_at, updated_at, completed_at, expires_at, source_mode, source_optimization
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      job.jobId,
      job.sessionId,
      job.status || "queued",
      job.currentStage || "queued",
      job.progressMessage || "",
      job.gameName || "",
      job.bggId || "",
      job.rulebookFileName || "",
      job.faqFileName || "",
      JSON.stringify(job.extraFileNames || []),
      job.inputKey || "",
      job.resultKey || "",
      job.errorMessage || "",
      job.errorStage || "",
      timestamp,
      timestamp,
      job.completedAt || null,
      job.expiresAt || null,
      job.sourceMode || "legacy",
      JSON.stringify(job.sourceOptimization || {})
    )
    .run();

  return getJobById(env, job.jobId);
}

export async function getJobById(env, jobId) {
  const row = await env.JOBS_DB.prepare(`SELECT * FROM jobs WHERE job_id = ?`).bind(jobId).first();
  return mapRow(row);
}

export async function listRecentJobs(env, sessionId, limit = 12) {
  const result = await env.JOBS_DB.prepare(
    `SELECT * FROM jobs WHERE session_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`
  )
    .bind(sessionId, limit)
    .all();
  return (result.results || []).map(mapRow);
}

export async function updateJobProgress(env, jobId, status, currentStage, progressMessage, extra = {}) {
  await env.JOBS_DB.prepare(
    `UPDATE jobs
     SET status = ?, current_stage = ?, progress_message = ?, updated_at = ?, source_mode = ?, source_optimization = ?
     WHERE job_id = ?`
  )
    .bind(
      status,
      currentStage,
      progressMessage || "",
      nowIso(),
      extra.sourceMode || "legacy",
      JSON.stringify(extra.sourceOptimization || {}),
      jobId
    )
    .run();
}

export async function markJobCompleted(env, jobId, resultKey, extra = {}) {
  const timestamp = nowIso();
  await env.JOBS_DB.prepare(
    `UPDATE jobs
     SET status = 'completed',
         current_stage = 'completed',
         progress_message = ?,
         result_key = ?,
         updated_at = ?,
         completed_at = ?,
         expires_at = ?,
         source_mode = ?,
         source_optimization = ?
     WHERE job_id = ?`
  )
    .bind(
      extra.progressMessage || "문서 생성이 완료되었습니다.",
      resultKey,
      timestamp,
      timestamp,
      extra.expiresAt || null,
      extra.sourceMode || "legacy",
      JSON.stringify(extra.sourceOptimization || {}),
      jobId
    )
    .run();
}

export async function markJobFailed(env, jobId, error, extra = {}) {
  await env.JOBS_DB.prepare(
    `UPDATE jobs
     SET status = 'failed',
         current_stage = 'failed',
         progress_message = ?,
         error_message = ?,
         error_stage = ?,
         updated_at = ?,
         source_mode = ?,
         source_optimization = ?
     WHERE job_id = ?`
  )
    .bind(
      extra.progressMessage || "문서 생성이 중단되었습니다.",
      error?.message || "처리 중 오류가 발생했습니다.",
      extra.errorStage || "",
      nowIso(),
      extra.sourceMode || "legacy",
      JSON.stringify(extra.sourceOptimization || {}),
      jobId
    )
    .run();
}

export async function markJobCancelling(env, jobId, extra = {}) {
  await env.JOBS_DB.prepare(
    `UPDATE jobs
     SET status = 'cancelling',
         progress_message = ?,
         updated_at = ?
     WHERE job_id = ? AND status IN ('queued', 'processing', 'cancelling')`
  )
    .bind(extra.progressMessage || "작업 중단 요청을 받았습니다. 가능한 가장 빠른 지점에서 멈춥니다.", nowIso(), jobId)
    .run();
}

export async function markJobCancelled(env, jobId, extra = {}) {
  const timestamp = nowIso();
  await env.JOBS_DB.prepare(
    `UPDATE jobs
     SET status = 'cancelled',
         current_stage = 'cancelled',
         progress_message = ?,
         error_message = '',
         error_stage = ?,
         updated_at = ?,
         completed_at = ?,
         expires_at = ?,
         source_mode = ?,
         source_optimization = ?
     WHERE job_id = ?`
  )
    .bind(
      extra.progressMessage || "사용자 요청으로 작업을 중단했습니다.",
      extra.errorStage || "",
      timestamp,
      timestamp,
      extra.expiresAt || null,
      extra.sourceMode || "legacy",
      JSON.stringify(extra.sourceOptimization || {}),
      jobId
    )
    .run();
}

export async function ensureJob(env, jobId) {
  const job = await getJobById(env, jobId);
  if (!job) {
    throw createUserError("요청한 작업을 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
  }
  return job;
}
