/**
 * In-memory store for analysis jobs.
 * Supports polling: POST starts a job, GET checks status.
 */

export interface AnalysisJob {
  id: string
  status: 'processing' | 'done' | 'error'
  step: string
  message: string
  percent: number
  analysis?: unknown
  error?: string
  createdAt: number
}

const jobs = new Map<string, AnalysisJob>()

/** Create a new job and return its ID */
export function createJob(): AnalysisJob {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const job: AnalysisJob = {
    id,
    status: 'processing',
    step: 'starting',
    message: '',
    percent: 0,
    createdAt: Date.now(),
  }
  jobs.set(id, job)
  return job
}

/** Get a job by ID (returns undefined if not found) */
export function getJob(id: string): AnalysisJob | undefined {
  return jobs.get(id)
}

/** Update job progress */
export function updateJob(id: string, update: Partial<Pick<AnalysisJob, 'step' | 'message' | 'percent'>>) {
  const job = jobs.get(id)
  if (job) Object.assign(job, update)
}

/** Mark job as done with analysis result */
export function completeJob(id: string, analysis: unknown) {
  const job = jobs.get(id)
  if (job) {
    job.status = 'done'
    job.step = 'done'
    job.message = 'Analysis complete!'
    job.percent = 100
    job.analysis = analysis
  }
}

/** Mark job as failed */
export function failJob(id: string, error: string) {
  const job = jobs.get(id)
  if (job) {
    job.status = 'error'
    job.step = 'error'
    job.message = error
    job.error = error
  }
}

/** Clean up old jobs (call periodically) */
export function cleanupOldJobs(maxAgeMs = 600_000) {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (now - job.createdAt > maxAgeMs) {
      jobs.delete(id)
    }
  }
}

// Auto-cleanup every 5 minutes
setInterval(() => cleanupOldJobs(), 300_000)