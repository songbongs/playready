const JOB_RETENTION_DAYS = 7;

export function createInputObjectKey(jobId) {
  return `jobs/${jobId}/input.json`;
}

export function createResultObjectKey(jobId) {
  return `jobs/${jobId}/result.json`;
}

export function buildExpiryIso(days = JOB_RETENTION_DAYS) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function saveJobInput(env, jobId, payload) {
  const key = createInputObjectKey(jobId);
  await env.JOBS_BUCKET.put(key, JSON.stringify(payload), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8"
    }
  });
  return key;
}

export async function readJobInput(env, key) {
  const object = await env.JOBS_BUCKET.get(key);
  if (!object) {
    return null;
  }
  return JSON.parse(await object.text());
}

export async function deleteJobInput(env, key) {
  if (!key) return;
  await env.JOBS_BUCKET.delete(key);
}

export async function saveJobResult(env, jobId, payload) {
  const key = createResultObjectKey(jobId);
  await env.JOBS_BUCKET.put(key, JSON.stringify(payload), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8"
    }
  });
  return key;
}

export async function readJobResult(env, key) {
  const object = await env.JOBS_BUCKET.get(key);
  if (!object) {
    return null;
  }
  return JSON.parse(await object.text());
}
